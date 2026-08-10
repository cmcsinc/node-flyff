/**
 * RevivalService -- death->revival loop (`DPSrvr::OnRevival*`,
 * `_Common/Mover.cpp::DoDie/SubDieDecExp`).
 *
 * Two entry points:
 *  - {@link onPlayerDeath}: called by `AISystem` on lethal damage. Flags dead,
 *    broadcasts `MOVERDEATH` to vicinity, sends `ACTMSG STOP+DIE` to the dying
 *    client (opens `CWndRevival`).
 *  - {@link revive}: called by `RevivalHandler` for the 3 C->S opcodes.
 *    `SCROLL` (`REVIVAL`) -- consume resurrection scroll, in-place revive, no
 *    exp penalty (non-chaotic). `LODESTAR` (`REVIVAL_TO_LODESTAR`) -- town revive,
 *    exp penalty + teleport to zone revival pos. `LODELIGHT` -- C++ stubs this
 *    empty; rejected.
 *
 * HP restore rate 0.2 * max (v19 non-chaotic v9+ default). Exp penalty is the
 * bracket table in `combat/formulas.subDieDecExp`.
 *
 * WAL: scroll consume + exp loss are journaled before the ack (rule 04).
 *
 * ponytail: chaotic/PK revive (different HP rate + PK town), guild-war revive
 * (full HP, no scroll consume), other-player resurrection skill, full REPLACE
 * teleport snapshot, DiePenalty.inc table loader, `m_nDead` 5s lockout.
 *
 * @module services/revival.service
 */

import type { CharacterRepository, InventoryRepository, Journal } from '@flyff/database';
import type { ZoneDefinition } from '@flyff/resources';
import type { CPlayer, Vec3 } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { VisibilityService } from '@flyff/world-core';
import { subDieDecExp } from '@flyff/combat';
import {
  II_SYS_SYS_SCR_RESURRECTION, OBJMSG_DIE, OBJMSG_STOP,
} from '@flyff/entities';
import { MAX_INVENTORY, VISIBILITY_RADIUS, buildRemoveSkillInfluence, buildResetDestParam } from '@flyff/world-core';
import {
  SNAPSHOTTYPE_REVIVAL, SNAPSHOTTYPE_REVIVAL_TO_LODESTAR,
} from '@flyff/world-core';
import { MoverDeathSerializer } from '@flyff/combat';
import { ActMsgSerializer } from '@flyff/inventory';
import { RevivalSerializer } from '../net/snapshot/revival.serializer';
import { SetExperienceSerializer } from '@flyff/combat';
import { SetPosSerializer } from '../net/snapshot/setPos.serializer';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'revival-service' });

export type RevivalType = 'SCROLL' | 'LODESTAR' | 'LODELIGHT';

export type RevivalOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_dead' | 'no_scroll' | 'lodelight_unsupported' };

export interface RevivalServiceDeps {
  readonly charRepo: Pick<CharacterRepository, 'updateLevelAndExp'>;
  readonly inventoryRepo: Pick<InventoryRepository, 'removeItem' | 'updateQuantity'>;
  readonly journal?: Journal;
  readonly zoneManager: ZoneManager;
  readonly playerManager: Pick<PlayerManager, 'sendTo'>;
  /** Zone revival-position lookup by numeric zone id (resources `byNumericId`). */
  readonly zones: { byNumericId: Map<number, ZoneDefinition> };
  /**
   * View re-diff after the revival teleport -- SETPOS relocates the player
   * without reloading the world, so the death-site spawns must be DEL_OBJ'd and
   * the town's ADD_OBJ'd. Optional for tests.
   */
  readonly visibilityService?: Pick<VisibilityService, 'refresh'>;
}

const REVIVE_HP_RATE = 0.2; // v19 non-chaotic v9+ default (DPSrvr.cpp:997,1100)
/** Chaotic (PK) players revive at half the normal HP rate (DPSrvr.cpp PK branch). */
const REVIVE_HP_RATE_CHAOTIC = 0.1;

export class RevivalService {
  private readonly moverDeath = new MoverDeathSerializer();
  private readonly actMsg = new ActMsgSerializer();
  private readonly revival = new RevivalSerializer();
  private readonly setExp = new SetExperienceSerializer();
  private readonly setPos = new SetPosSerializer();

  constructor(private readonly deps: RevivalServiceDeps) {}

  /**
   * `CMover::DoDie` player path. Idempotent -- the `m_bDead` guard stops
   * double-trigger on multi-hit ticks that both cross HP=0.
   */
  onPlayerDeath(player: CPlayer, killerObjid: number): void {
    if (player.m_bDead) return;
    player.m_bDead = true;

    // Clear all active buffs (C++ DoDie drops the skill-state list). Reverses
    // each DST delta on m_params + broadcasts REMOVESKILLINFULENCE + RESETDESTPARAM
    // per buff so peers + self drop the icons and stat-window deltas.
    for (const buff of player.m_buffs.clear()) {
      this.deps.zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        buildRemoveSkillInfluence(player.m_idPlayer, buff.type, buff.skillId),
      );
      for (const e of buff.effects) {
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildResetDestParam(player.m_idPlayer, e.dst, e.adj),
        );
      }
    }

    // Vicinity: peers play the death animation (AddMoverDeath, User.cpp:4488).
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.moverDeath.build(player.m_idPlayer, killerObjid, 0),
    );
    // Self: halt then open the revive dialog (SendActMsg OBJMSG_STOP/OBJMSG_DIE).
    this.deps.playerManager.sendTo(player, this.actMsg.build(player.m_idPlayer, OBJMSG_STOP, 0, 0));
    this.deps.playerManager.sendTo(
      player, this.actMsg.build(player.m_idPlayer, OBJMSG_DIE, 0, killerObjid),
    );
  }

  /** `OnRevival` / `OnRevivalLodestar` / `OnRevivalLodelight` dispatch. */
  revive(player: CPlayer, type: RevivalType): RevivalOutcome {
    if (type === 'LODELIGHT') return { ok: false, reason: 'lodelight_unsupported' };
    if (!player.m_bDead && player.m_nHp > 0) return { ok: false, reason: 'not_dead' };

    if (type === 'SCROLL') return this.reviveScroll(player);
    return this.reviveLodestar(player);
  }

  /** `OnRevival` (0x00ff00c0) -- scroll revive in place. */
  private reviveScroll(player: CPlayer): RevivalOutcome {
    const slot = this.findScrollSlot(player);
    if (slot < 0) return { ok: false, reason: 'no_scroll' };
    const stack = player.m_Inventory[slot];
    if (stack === undefined || stack === null) return { ok: false, reason: 'no_scroll' };

    // WAL journal the slot's ABSOLUTE post-state before the client ack (rule
    // 04): either decremented stack or cleared slot. Idempotent -- the boot
    // replayer re-applies this exact slot contents if the consume persist lost
    // the race with a crash.
    const remaining = stack.count - 1;
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'INVENTORY_SLOT',
      payload: remaining > 0
        ? { slot, itemId: II_SYS_SYS_SCR_RESURRECTION, count: remaining }
        : { slot, itemId: 0, count: 0 },
    });
    this.consumeSlot(player, slot, stack);

    this.clearDeadState(player);
    this.restoreVitals(player);
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.revival.build(player.m_idPlayer, SNAPSHOTTYPE_REVIVAL),
    );
    return { ok: true };
  }

  /** `OnRevivalLodestar` (0x00ff00c1) -- town revive + exp penalty + teleport. */
  private reviveLodestar(player: CPlayer): RevivalOutcome {
    this.clearDeadState(player);

    const before = player.m_nExp;
    const pen = subDieDecExp(player.m_nLevel, player.m_nExp, player.m_params);
    const lost = before - pen.exp;
    if (lost > 0) {
      player.m_nExp = pen.exp;
      player._dirty.add('m_nExp');
      // WAL journal the ABSOLUTE post-state before the client ack (rule 04).
      // Idempotent -- the boot replayer re-applies (level, exp) if the
      // fire-and-forget persist below lost the race with a crash. m_nExp IS
      // the within-level value the DB + wire carry (no cumulative form).
      const exp = String(Math.floor(player.m_nExp));
      this.deps.journal?.append({
        charId: player.m_idPlayer, type: 'CHAR_EXP',
        payload: { level: player.m_nLevel, exp },
      });
      this.deps.playerManager.sendTo(player, this.setExp.build(player.m_idPlayer, {
        exp: player.m_nExp, level: player.m_nLevel,
      }));
      this.deps.charRepo.updateLevelAndExp(
        player.m_idPlayer, player.m_nLevel, BigInt(Math.floor(player.m_nExp)),
      ).catch((err: unknown) => { logger.error({ err, charId: player.m_idPlayer }, 'exp persist failed'); });
    }

    this.restoreVitals(player);
    // Broadcast REVIVAL_TO_LODESTAR at the death vicinity BEFORE teleporting
    // (DPSrvr.cpp:1122 precedes the REPLACE at :1143) so peers who saw the death
    // play the revive animation before the player leaves their view.
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.revival.build(player.m_idPlayer, SNAPSHOTTYPE_REVIVAL_TO_LODESTAR),
    );
    this.teleportToRevival(player);
    return { ok: true };
  }

  private clearDeadState(player: CPlayer): void {
    player.m_bDead = false;
    // ponytail: ClearState buffs when the buff system lands.
  }

  /**
   * HP/MP restore on revive. Non-chaotic players get 0.2 * max (v19 default);
   * chaotic (PK) players get half that (0.1 * max) -- the PK death penalty.
   * ponytail: full DiePenalty.inc REVIVAL_PENALTY bracket table (level-based).
   */
  private restoreVitals(player: CPlayer): void {
    const rate = player.isChaotic() ? REVIVE_HP_RATE_CHAOTIC : REVIVE_HP_RATE;
    const hp = Math.floor(player.m_nMaxHp * rate);
    const mp = Math.floor(player.m_nMaxMp * rate);
    if (player.m_nHp < hp) { player.m_nHp = hp; player._dirty.add('m_nHp'); }
    if (player.m_nMp < mp) { player.m_nMp = mp; player._dirty.add('m_nMp'); }
  }

  /**
   * Same-world teleport to the zone's revival position via `SETPOS` -- the C++
   * `_replace` same-world branch (`World.cpp:1589-1604`). The client's `OnSetPos`
   * relocates the local player (ReadWorld + SetPos) WITHOUT nulling `g_pPlayer`,
   * so ticking UI windows stay safe.
   *
   * `REPLACE` would null `g_pPlayer` (`DPClient.cpp:2352`) and -- since we don't
   * re-send the player's own ADD_OBJ -- leave it null, crashing the first window
   * to deref it (`CWndQuestQuickInfo::Process:259`).
   * ponytail: cross-world teleports need REPLACE followed by self `AddAddObj`
   * to restore `g_pPlayer`; plus real `GetNearRevivalPos` nearest-point tables.
   */
  private teleportToRevival(player: CPlayer): void {
    const zone = this.deps.zones.byNumericId.get(player.m_nZoneId);
    const revivePos: Vec3 = zone?.revival.position ?? player.m_vPos;
    player.m_vPos = { ...revivePos };
    player._dirty.add('m_vPos');
    this.deps.playerManager.sendTo(player, this.setPos.build(player.m_idPlayer, revivePos));
    this.deps.visibilityService?.refresh(player.m_idPlayer, true);
  }

  private findScrollSlot(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      const s = player.m_Inventory[i];
      if (s && s.itemId === II_SYS_SYS_SCR_RESURRECTION) return i;
    }
    return -1;
  }

  private consumeSlot(player: CPlayer, slot: number, stack: { count: number }): void {
    if (stack.count > 1) {
      stack.count--;
      player._dirty.add('m_Inventory');
      this.deps.inventoryRepo.updateQuantity(player.m_idPlayer, slot, stack.count)
        .catch((err: unknown) => void err);
    } else {
      player.m_Inventory[slot] = null;
      player._dirty.add('m_Inventory');
      this.deps.inventoryRepo.removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => void err);
    }
  }
}
