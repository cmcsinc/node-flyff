/**
 * UseItemService -- `DOUSEITEM` router (`PACKETTYPE_DOUSEITEM` 0x00ff0021).
 *
 * Ports `CMover::DoUseItem` (`_Common/MoverSkill.cpp:1275`): unpacks the slot
 * from `HIWORD(dwData)`, resolves the item, then routes by `dwParts`/`dwItemKind2`
 * -- equip (dwParts set) / potion+food / buff / skill / text / warp. Returns a
 * discriminated result the handler turns into snapshots (DOEQUIP for equip,
 * SETPOINTPARAM for vitals). Buff/skill/warp/text consume the charge and log;
 * their effect subsystems land later (ponytail).
 *
 * @module services/useItem
 */

import type { ItemDefinition } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';
import { BUFF_ITEM } from '@flyff/entities';
import { MAX_INVENTORY, INVENTORY_SLOTS, buildSetSkillState, buildSetDestParam, VISIBILITY_RADIUS } from '@flyff/world-core';
import type { ZoneManager, PlayerManager } from '@flyff/world-core';
import type { EquipService, EquipResult, UnequipResult } from './equip.service';
import type { ConsumableService } from './consumable.service';
import type { InventoryService } from './inventory.service';
import type { BlinkwingService } from './blinkwing.service';
import { cooltimeGroup } from './cooltime';

const logger = createLogger({ module: 'useItem-service' });

export type UseResult =
  | { kind: 'equip'; equip: EquipResult | UnequipResult; unequip: boolean }
  | { kind: 'consumable'; nId: number; remaining: number; hp?: number; mp?: number; fp?: number; cooltime?: boolean }
  | { kind: 'consumed'; nId: number; remaining: number; cooltime?: boolean } // buff/skill/warp/text -- charge spent, effect ponytail
  | { kind: 'pet' } // IK3_PET looter toggled; no charge spent, no client echo
  // Blinkwing channel armed (or, for a 0 ms item, fired outright). The blinkwing
  // service owns every wire frame on this path (STATEMODE, SETPOS, UPDATE_ITEM),
  // so the handler has nothing left to send.
  | { kind: 'channel' }
  | { kind: 'reject'; tid?: number };

export interface UseItemServiceDeps {
  equipService: EquipService;
  consumableService: ConsumableService;
  inventoryService: InventoryService;
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** Potion-group cooldown fallback (ms) when an item carries no `cooldown_ms`. */
  potionCooldownMs: number;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  /**
   * Looter-pet toggle seam -- `CMover::DoUseEatPet` (`MoverSkill.cpp:4355`).
   * Wired to `PetSystem.toggle` in `compose.ts`; structural so `@flyff/inventory`
   * never imports `@flyff/world-server`. Absent = pet items do nothing (the
   * pre-pet behaviour).
   */
  togglePet?: (player: CPlayer, itemObjid: number, linkKind: number) => boolean;
  /** `IK2_BLINKWING` teleport scrolls. Absent = blinkwings reject (bare tests). */
  blinkwingService?: BlinkwingService;
}

export class UseItemService {
  constructor(private readonly deps: UseItemServiceDeps) {}

  use(player: CPlayer, slot: number, nPart: number): UseResult {
    // Slot may address the bag (0..MAX_INVENTORY) OR an equip slot -- DOUSEITEM
    // on an equipped item is the C++ unequip path (`DoUseEquipmentItem` computes
    // `bEquip = !IsEquip(dwId)`, MoverEquip.cpp:2624). Bounding at MAX_INVENTORY
    // rejected every double-click-to-unequip.
    if (slot < 0 || slot >= INVENTORY_SLOTS) return { kind: 'reject' };
    const invSlot = player.m_Inventory[slot];
    if (!invSlot) return { kind: 'reject' };
    const prop = this.deps.getItem(invSlot.itemId);
    if (!prop) return { kind: 'reject' };

    if (slot >= MAX_INVENTORY) {
      const unequip = this.deps.equipService.unequip(player, slot - MAX_INVENTORY);
      return { kind: 'equip', equip: unequip, unequip: true };
    }
    if (prop.equip_slot !== undefined) {
      const equip = this.deps.equipService.equip(player, slot, nPart > 0 ? nPart : prop.equip_slot);
      return { kind: 'equip', equip, unequip: false };
    }

    // Cooldown gate (C++ DoUseItem:1335 -- GetGroup + CanUse BEFORE UseItem).
    // Group 0 = no cooldown; otherwise reject silently if still on cooldown.
    // Charge is NOT spent on rejection -- mirrors the C++ gate-before-afford order.
    const k2 = prop.item_kind2;
    const cd = cooltimeGroup(prop, this.deps.potionCooldownMs);
    if (cd.group > 0) {
      const now = Date.now();
      const expiry = player.m_cooltime[cd.group - 1] ?? 0;
      const onCooldown = expiry > now;
      logger.info({ charId: player.m_idPlayer, itemId: invSlot.itemId, k2, group: cd.group, cdMs: cd.ms, onCooldown, expiryIn: onCooldown ? expiry - now : 0 }, 'use-item cooldown gate');
      if (onCooldown) return { kind: 'reject' };
    } else {
      logger.info({ charId: player.m_idPlayer, itemId: invSlot.itemId, k2, group: 0 }, 'use-item cooldown gate (no group)');
    }

    // `IK3_PET` looter toggle. C++ reaches this from the `dwItemKind3` switch in
    // the `DoUseItem` tail (`MoverSkill.cpp:1906`), which runs BEFORE
    // `pItemElem->UseItem()`; pet rows all carry `bPermanence = 1` so that call
    // is a no-op for them. Returning before any consume path is the same net
    // effect and doesn't depend on a permanence column we don't parse.
    if (prop.item_kind3 === 'IK3_PET') {
      if (prop.link_kind === undefined) {
        logger.warn({ charId: player.m_idPlayer, itemId: prop.id }, 'pet item has no link_kind');
        return { kind: 'reject' };
      }
      const objid = invSlot.objid ?? player.clientObjId(slot);
      const handled = this.deps.togglePet?.(player, objid, prop.link_kind) ?? false;
      return handled ? { kind: 'pet' } : { kind: 'reject' };
    }

    // `IK2_BLINKWING` teleport scrolls (`MoverSkill.cpp:1715` -> the
    // `DoUseItemBlinkWing` case). Two-pass: this arms a channel, and
    // `BlinkwingSystem` fires the teleport when it elapses. The service sends its
    // own frames, so nothing comes back for the handler to echo.
    if (k2 === 'IK2_BLINKWING') {
      const svc = this.deps.blinkwingService;
      if (!svc) return { kind: 'reject' };
      const objid = invSlot.objid ?? player.clientObjId(slot);
      const r = svc.begin(player, slot, objid, prop);
      if (r.kind === 'refuse') return r.tid !== undefined ? { kind: 'reject', tid: r.tid } : { kind: 'reject' };
      return { kind: 'channel' };
    }

    if (k2 === 'IK2_POTION' || k2 === 'IK2_FOOD') {
      const r = this.deps.consumableService.apply(player, prop, slot);
      const out: { kind: 'consumable'; nId: number; remaining: number; hp?: number; mp?: number; fp?: number; cooltime?: boolean } =
        { kind: 'consumable', nId: slot, remaining: Math.max(0, r.consumed?.count ?? 0) };
      if (r.hp !== undefined) out.hp = r.hp;
      if (r.mp !== undefined) out.mp = r.mp;
      if (r.fp !== undefined) out.fp = r.fp;
      if (cd.group > 0) {
        player.m_cooltime[cd.group - 1] = Date.now() + cd.ms;
        out.cooltime = true;
      }
      return out;
    }
    if (k2 === 'IK2_BUFF' || k2 === 'IK2_BUFF2' || k2 === 'IK2_SKILL' || k2 === 'IK2_TEXT' || k2 === 'IK2_WARP') {
      const consumed = this.deps.inventoryService.consume(player, slot, 1);
      const remaining = Math.max(0, consumed?.count ?? 0);
      // Buff items (IK2_BUFF/IK2_BUFF2): attach a timed DST buff (CBuffItem path,
      // C++ MoverSkill.cpp:1335). Effects come from the item's `dwDestParam*`
      // triplets; duration from the item's `duration` field (seconds→ms).
      if (k2 === 'IK2_BUFF' || k2 === 'IK2_BUFF2') {
        const effects = prop.effects;
        const durationMs = (prop.duration ?? 0) * 1_000;
        if (effects.length > 0 && durationMs > 0) {
          const now = Date.now();
          player.m_buffs.addItemBuff(prop.id, durationMs, effects, now);
          // Vicinity, not self-only: C++ `CBuffMgr::AddBuff` (`buff.cpp:760`)
          // routes every buff type through `AddSetSkillState`, which is
          // `FOR_VISIBILITYRANGE` (`User.cpp:5631`). Peers need the icon so an
          // item buff shows in their target display like a skill buff does.
          this.deps.zoneManager.broadcastAround(
            player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
            buildSetSkillState(player.m_idPlayer, BUFF_ITEM, prop.id, 0, durationMs),
          );
          for (const e of effects) {
            this.deps.zoneManager.broadcastAround(
              player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
              buildSetDestParam(player.m_idPlayer, e.dst, e.adj, e.chg),
            );
          }
        }
      }
      // skill/warp/text items: charge consumed, no effect yet. ponytail: skill
      // items, text items, warp items.
      logger.info({ charId: player.m_idPlayer, itemId: invSlot.itemId, k2 }, 'use-item: charge consumed');
      const out: { kind: 'consumed'; nId: number; remaining: number; cooltime?: boolean } =
        { kind: 'consumed', nId: slot, remaining };
      if (cd.group > 0) {
        player.m_cooltime[cd.group - 1] = Date.now() + cd.ms;
        out.cooltime = true;
      }
      return out;
    }
    return { kind: 'reject' };
  }
}
