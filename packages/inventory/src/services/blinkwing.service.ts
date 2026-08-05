/**
 * BlinkwingService -- `IK2_BLINKWING` teleport scrolls (blinkwings + Return).
 *
 * Ports `CMover::DoUseItemBlinkWing` (`_Common/MoverSkill.cpp:1944`) and the
 * channel half of `CMover::IsItemRedyTime` (`_Common/Mover.cpp:8795`).
 *
 * A blinkwing use is TWO passes, not one:
 *  1. First `DOUSEITEM`: gates run, then the channel is armed
 *     (`m_nReadyTime = now + dwSkillReadyType`, `STATE_BASEMOTION_MODE` set) and
 *     the function returns without teleporting. 10 s for blinkwings, 300 s for
 *     the Return scroll. The client draws the cast bar off the `STATEMODE`
 *     snapshot and spawns `dwSfxObj` (`XI_BLINKWING_READY`).
 *  2. When the timer elapses, C++'s per-user tick re-enters `DoUseItem`
 *     (`WORLDSERVER/User.cpp:382-410`). Here {@link BlinkwingSystem} calls
 *     {@link complete} instead. The channel state is cleared, the charge is
 *     spent, and only then does the teleport fire.
 *
 * Destination by `dwItemKind3`:
 *  - `IK3_BLINKWING` -- fixed, from the item's own prop columns
 *    (`blink_world`/`blink_pos`/`blink_angle`; see the item converter).
 *  - `IK3_TOWNBLINKWING` -- resolved at use time from the current world's
 *    revival point (`GetNearRevivalPos`, `worldmng.cpp:627`).
 *
 * The teleport itself is an injected port: `@flyff/inventory` must not depend on
 * `@flyff/world-server`, where `SetPosSerializer` + `VisibilityService.refresh`
 * are wired (same pattern as `AdminCommandService.setPosSer`).
 *
 * ponytail: several C++ gates have no ported subsystem to check --
 *   - sitting (`IsSit`, TID_GAME_NOTSIT_BLINK 3318): `OBJSTAF.SIT` is never
 *     driven server-side; only `OBJSTAF.FLY` is.
 *   - world bans (Kebaras PK map, guild war, miniroom/housing, secret room,
 *     rainbow race, 1v1 guild combat): none of those worlds or minigames exist.
 *   - chaotic (PK) revival redirect (`GetRevivalPosChao`, `MoverSkill.cpp:2073`):
 *     no chaotic revival tables are ported, so a chaotic player teleports to the
 *     ordinary revival point.
 *   - `SM_ESCAPE` reuse cooldown (`dwCircleTime` seconds, `MoverSkill.cpp:1309`):
 *     the SM-mode timer array is unported, so the Return scroll can be re-used
 *     as fast as its 300 s channel allows.
 *   - cross-world teleports: `SNAPSHOTTYPE_REPLACE` nulls the client's
 *     `g_pPlayer` and needs a self `ADD_OBJ` re-send to restore it, which does
 *     not exist -- so a blinkwing whose `blink_world` is not the player's
 *     current world is refused rather than crashing the client.
 * ponytail: server-side cancel-on-attack. C++ `CMover::IsAttackAble`
 *   (`Mover.cpp:6693`) clears the channel and refuses the swing, and
 *   `MoverMsg.cpp:196` does the same for a skill cast. Today only the client's
 *   own `PACKETTYPE_STATEMODE` cancel (which it sends on move / jump / hit,
 *   `DPClient.cpp:1827`) breaks the cast, so a tampered client could blink while
 *   fighting. Death is covered ({@link BlinkwingSystem} cancels dead casters).
 *
 * @module services/blinkwing
 */

import type { ItemDefinition, ZoneDefinition } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, Vec3 } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import { STATE_BASEMOTION_MODE, STATEMODE } from '@flyff/world-core';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';
import type { InventoryService } from './inventory.service';

const logger = createLogger({ module: 'blinkwing-service' });

/** `II_CHR_SYS_SCR_ESCAPEBLINKWING` (`defineItem.h:2572`) -- the Return scroll. */
export const II_CHR_SYS_SCR_ESCAPEBLINKWING = 10435;

/** `defineText.h` refusal ids the client renders via `SNAPSHOTTYPE_DEFINEDTEXT`. */
export const BLINKWING_TID = Object.freeze({
  /** 1151 -- level too low to use this item. defineText.h:1006. */
  USINGNOTLEVEL: 1151,
  /** 2484 -- the channel could not finish (item gone / cannot use here). defineText.h:1608. */
  BLINK_LIMIT: 2484,
} as const);

/**
 * Zone `world_id` slug -> `WI_*` world id (`defineWorld.h`). Blinkwings address
 * their destination by `WI_*`, but zones carry a slug, and the two namespaces
 * are not derivable from each other (`madrigal` -> `WI_WORLD_MADRIGAL` 1, but
 * `volcane` -> `WI_DUNGEON_VOLCANE` 203). One entry per loaded world.
 * ponytail: extend as further worlds land, or move onto the zone schema.
 */
const WI_BY_WORLD_SLUG: Record<string, number> = { madrigal: 1 };

export type BlinkwingUse =
  | { kind: 'channel'; itemId: number; readyMs: number }
  | { kind: 'refuse'; tid?: number };

export interface BlinkwingTarget {
  readonly pos: Vec3;
  readonly angle: number;
}

export interface BlinkwingServiceDeps {
  inventoryService: InventoryService;
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** Zone index -- read for the current world's revival point + `WI_*` id. */
  zones: { byNumericId: Map<number, ZoneDefinition> };
  playerManager: PlayerManager;
  /**
   * Same-world relocate: set the position, send `SNAPSHOTTYPE_SETPOS`, re-diff
   * the view. Injected from `compose.ts` (world-server owns the serializer).
   */
  teleport: (player: CPlayer, pos: Vec3) => void;
  /** Broadcast a `SNAPSHOTTYPE_STATEMODE` frame to the caster's vicinity. */
  broadcastStateMode: (player: CPlayer, flag: number, itemId?: number) => void;
  /** Send a `SNAPSHOTTYPE_DEFINEDTEXT` refusal notice to this player. */
  notify?: (player: CPlayer, tid: number) => void;
}

export class BlinkwingService {
  constructor(private readonly deps: BlinkwingServiceDeps) {}

  /**
   * First `DOUSEITEM` pass -- run the gates and arm the channel. Never
   * teleports and never spends the charge (C++ `IsItemRedyTime` returns FALSE
   * on the arming pass, so `DoUseItemBlinkWing` is not reached until pass 2).
   */
  begin(player: CPlayer, slot: number, objid: number, prop: ItemDefinition): BlinkwingUse {
    // DoUseItem:1386 -- dead movers cannot use items.
    if (player.m_bDead) return { kind: 'refuse' };
    // Mover.cpp:8801 / MoverSkill.cpp:1950 -- one channel at a time.
    if (this.isChanneling(player)) return { kind: 'refuse' };
    // MoverSkill.cpp:1995 -- `dwLimitLevel1` is a USE gate, distinct from the
    // equip-level requirement.
    if (prop.use_level !== undefined && player.m_nLevel < prop.use_level) {
      return { kind: 'refuse', tid: BLINKWING_TID.USINGNOTLEVEL };
    }
    // Mover.cpp:2408 -- REPLACE_NORMAL refuses while airborne; the Return
    // scroll uses REPLACE_FORCE and so may be used in flight.
    if (player.isFly() && prop.id !== II_CHR_SYS_SCR_ESCAPEBLINKWING) {
      return { kind: 'refuse' };
    }
    // Resolve the destination BEFORE arming: C++ reaches `DoUseItemBlinkWing`'s
    // `WI_WORLD_NONE` bail only after the channel, but a 10 s cast that can
    // never land is worse than an immediate refusal, and either way no charge
    // is spent.
    if (!this.resolveTarget(player, prop)) {
      logger.debug({ charId: player.m_idPlayer, itemId: prop.id }, 'blinkwing has no reachable destination');
      return { kind: 'refuse' };
    }

    const readyMs = prop.ready_ms ?? 0;
    if (readyMs <= 0) {
      // No channel configured -- teleport on this pass (C++ skips the whole
      // ready-time block when `dwSkillReadyType` is 0/NULL_ID).
      return this.fire(player, slot, objid, prop) ? { kind: 'channel', itemId: prop.id, readyMs: 0 } : { kind: 'refuse' };
    }

    player.m_nReadyTime = Date.now() + readyMs;
    player.m_dwUseItemObjId = objid;
    player.m_dwStateMode |= STATE_BASEMOTION_MODE;
    // ON carries the item id -- the client reads it to spawn `dwSfxObj` and to
    // scale its cast bar by `dwSkillReadyType`.
    this.deps.broadcastStateMode(player, STATEMODE.BASEMOTION_ON, prop.id);
    logger.info({ charId: player.m_idPlayer, itemId: prop.id, readyMs }, 'blinkwing channel armed');
    return { kind: 'channel', itemId: prop.id, readyMs };
  }

  /** True while an item channel is running. */
  isChanneling(player: CPlayer): boolean {
    return (player.m_dwStateMode & STATE_BASEMOTION_MODE) !== 0;
  }

  /**
   * Channel elapsed -- clear the state, re-resolve the item, spend the charge,
   * teleport. Mirrors `CUser::Process` (`WORLDSERVER/User.cpp:382-410`): the
   * item is looked up again by its stable objid, and a channel whose item
   * vanished (moved to the bank, dropped, sold) is cancelled with
   * `TID_PK_BLINK_LIMIT` rather than teleporting for free.
   */
  complete(player: CPlayer): void {
    const objid = player.m_dwUseItemObjId;
    this.clearChannel(player);

    if (player.m_bDead) { this.deps.broadcastStateMode(player, STATEMODE.BASEMOTION_CANCEL); return; }

    const slot = player.findSlotByObjId(objid);
    const itemId = slot >= 0 ? player.m_Inventory[slot]?.itemId : undefined;
    const prop = itemId !== undefined ? this.deps.getItem(itemId) : undefined;
    if (slot < 0 || !prop || prop.item_kind2 !== 'IK2_BLINKWING') {
      this.deps.notify?.(player, BLINKWING_TID.BLINK_LIMIT);
      this.deps.broadcastStateMode(player, STATEMODE.BASEMOTION_CANCEL);
      return;
    }

    if (!this.fire(player, slot, objid, prop)) {
      this.deps.notify?.(player, BLINKWING_TID.BLINK_LIMIT);
      this.deps.broadcastStateMode(player, STATEMODE.BASEMOTION_CANCEL);
      return;
    }
    this.deps.broadcastStateMode(player, STATEMODE.BASEMOTION_OFF);
  }

  /**
   * Abort a running channel -- the client's `PACKETTYPE_STATEMODE` cancel
   * (sent on move / jump / taking or dealing a hit), death, and logout all land
   * here. `CDPSrvr::OnStateMode` (`DPSrvr.cpp:6844`) clears exactly these three
   * fields. No-op when nothing is channeling.
   */
  cancel(player: CPlayer, notifyPeers = true): void {
    if (!this.isChanneling(player)) return;
    this.clearChannel(player);
    if (notifyPeers) this.deps.broadcastStateMode(player, STATEMODE.BASEMOTION_CANCEL);
    logger.debug({ charId: player.m_idPlayer }, 'blinkwing channel cancelled');
  }

  /** Spend the charge, then relocate. Returns false if either step is impossible. */
  private fire(player: CPlayer, slot: number, objid: number, prop: ItemDefinition): boolean {
    const target = this.resolveTarget(player, prop);
    if (!target) return false;
    // C++ decrements BEFORE queueing the teleport (`MoverSkill.cpp:2009-2016`
    // and `:2059-2066`). `consume` journals the absolute post-state, so a crash
    // between here and the relocate cannot dupe the scroll.
    const left = this.deps.inventoryService.consume(player, slot, 1);
    if (left === null) return false;
    // The same C++ lines echo `UpdateItem( m_dwObjId, UI_NUM, m_nItemNum )` --
    // keyed by the STABLE objid, never the slot. Without it the client never sees
    // the stack drop. UI_NUM (not UI_COOLTIME): blinkwings have no cooldown group
    // (`CCooltimeMgr::GetGroup` covers only food/skill, `CooltimeMgr.cpp:19`).
    this.deps.playerManager.sendTo(
      player,
      buildUpdateItemCount(player.m_idPlayer, objid, Math.max(0, left.count)),
    );

    // `SetAngle` (MoverSkill.cpp:2057) is server-side only -- SETPOS carries no
    // angle, so the client keeps its own facing until the next movement frame.
    player.m_fAngle = target.angle;
    player._dirty.add('angle');
    this.deps.teleport(player, target.pos);
    logger.info({ charId: player.m_idPlayer, itemId: prop.id, objid, to: target.pos }, 'blinkwing teleport');
    return true;
  }

  /**
   * Where does `prop` send `player`? `null` when unreachable -- no destination
   * data, an unknown world, or a cross-world hop (unported REPLACE).
   */
  private resolveTarget(player: CPlayer, prop: ItemDefinition): BlinkwingTarget | null {
    const zone = this.deps.zones.byNumericId.get(player.m_nZoneId);
    if (!zone) return null;

    if (prop.item_kind3 === 'IK3_TOWNBLINKWING') {
      // GetNearRevivalPos (`worldmng.cpp:627`) picks the nearest revival point
      // in the current world; with one zone loaded that is the zone's own.
      return { pos: { ...zone.revival.position }, angle: player.m_fAngle };
    }

    // MoverSkill.cpp:2054 -- WI_WORLD_NONE / NULL_ID means "no destination".
    if (prop.blink_world === undefined || prop.blink_pos === undefined) return null;
    const currentWorld = WI_BY_WORLD_SLUG[zone.world_id];
    if (currentWorld === undefined || currentWorld !== prop.blink_world) return null;
    return { pos: { ...prop.blink_pos }, angle: prop.blink_angle ?? player.m_fAngle };
  }

  private clearChannel(player: CPlayer): void {
    player.m_dwStateMode &= ~STATE_BASEMOTION_MODE;
    player.m_nReadyTime = 0;
    player.m_dwUseItemObjId = 0;
  }
}
