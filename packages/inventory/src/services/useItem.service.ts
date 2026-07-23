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
import { MAX_INVENTORY } from '@flyff/world-core';
import type { EquipService, EquipResult } from './equip.service';
import type { ConsumableService } from './consumable.service';
import type { InventoryService } from './inventory.service';
import { cooltimeGroup } from './cooltime';

const logger = createLogger({ module: 'useItem-service' });

export type UseResult =
  | { kind: 'equip'; equip: EquipResult }
  | { kind: 'consumable'; nId: number; remaining: number; hp?: number; mp?: number; fp?: number; cooltime?: boolean }
  | { kind: 'consumed'; nId: number; remaining: number; cooltime?: boolean } // buff/skill/warp/text -- charge spent, effect ponytail
  | { kind: 'reject' };

export interface UseItemServiceDeps {
  equipService: EquipService;
  consumableService: ConsumableService;
  inventoryService: InventoryService;
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** Potion-group cooldown fallback (ms) when an item carries no `cooldown_ms`. */
  potionCooldownMs: number;
}

export class UseItemService {
  constructor(private readonly deps: UseItemServiceDeps) {}

  use(player: CPlayer, slot: number, nPart: number): UseResult {
    if (slot < 0 || slot >= MAX_INVENTORY) return { kind: 'reject' };
    const invSlot = player.m_Inventory[slot];
    if (!invSlot) return { kind: 'reject' };
    const prop = this.deps.getItem(invSlot.itemId);
    if (!prop) return { kind: 'reject' };

    if (prop.equip_slot !== undefined) {
      const equip = this.deps.equipService.equip(player, slot, nPart > 0 ? nPart : prop.equip_slot);
      return { kind: 'equip', equip };
    }

    // Cooldown gate (C++ DoUseItem:1335 -- GetGroup + CanUse BEFORE UseItem).
    // Group 0 = no cooldown; otherwise reject silently if still on cooldown.
    // Charge is NOT spent on rejection -- mirrors the C++ gate-before-afford order.
    const cd = cooltimeGroup(prop, this.deps.potionCooldownMs);
    if (cd.group > 0) {
      const now = Date.now();
      if ((player.m_cooltime[cd.group - 1] ?? 0) > now) return { kind: 'reject' };
    }

    const k2 = prop.item_kind2;
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
      logger.info({ charId: player.m_idPlayer, itemId: invSlot.itemId, k2 }, 'use-item: charge consumed (effect ponytail)');
      const out: { kind: 'consumed'; nId: number; remaining: number; cooltime?: boolean } =
        { kind: 'consumed', nId: slot, remaining: Math.max(0, consumed?.count ?? 0) };
      if (cd.group > 0) {
        player.m_cooltime[cd.group - 1] = Date.now() + cd.ms;
        out.cooltime = true;
      }
      return out;
    }
    return { kind: 'reject' };
  }
}
