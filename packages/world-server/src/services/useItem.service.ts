/**
 * UseItemService — `DOUSEITEM` router (`PACKETTYPE_DOUSEITEM` 0x00ff0021).
 *
 * Ports `CMover::DoUseItem` (`_Common/MoverSkill.cpp:1275`): unpacks the slot
 * from `HIWORD(dwData)`, resolves the item, then routes by `dwParts`/`dwItemKind2`
 * — equip (dwParts set) / potion+food / buff / skill / text / warp. Returns a
 * discriminated result the handler turns into snapshots (DOEQUIP for equip,
 * SETPOINTPARAM for vitals). Buff/skill/warp/text consume the charge and log;
 * their effect subsystems land later (ponytail).
 *
 * @module services/useItem
 */

import type { ItemDefinition } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger.js';
import type { CPlayer } from '../entities/player.js';
import { MAX_INVENTORY } from '../net/snapshot/constants.js';
import type { EquipService, EquipResult } from './equip.service.js';
import type { ConsumableService } from './consumable.service.js';
import type { InventoryService } from './inventory.service.js';

const logger = createLogger({ module: 'useItem-service' });

export type UseResult =
  | { kind: 'equip'; equip: EquipResult }
  | { kind: 'consumable'; nId: number; hp?: number; mp?: number; fp?: number }
  | { kind: 'consumed'; nId: number } // buff/skill/warp/text — charge spent, effect ponytail
  | { kind: 'reject' };

export interface UseItemServiceDeps {
  equipService: EquipService;
  consumableService: ConsumableService;
  inventoryService: InventoryService;
  getItem: (itemId: number) => ItemDefinition | undefined;
}

export class UseItemService {
  constructor(private readonly deps: UseItemServiceDeps) {}

  use(player: CPlayer, dwData: number, nPart: number): UseResult {
    const nId = (dwData >>> 16) & 0xffff;
    if (nId < 0 || nId >= MAX_INVENTORY) return { kind: 'reject' };
    const slot = player.m_Inventory[nId];
    if (!slot) return { kind: 'reject' };
    const prop = this.deps.getItem(slot.itemId);
    if (!prop) return { kind: 'reject' };

    if (prop.equip_slot !== undefined) {
      const equip = this.deps.equipService.equip(player, nId, nPart > 0 ? nPart : prop.equip_slot);
      return { kind: 'equip', equip };
    }

    const k2 = prop.item_kind2;
    if (k2 === 'IK2_POTION' || k2 === 'IK2_FOOD') {
      const r = this.deps.consumableService.apply(player, prop, nId);
      return { kind: 'consumable', nId, hp: r.hp, mp: r.mp, fp: r.fp };
    }
    if (k2 === 'IK2_BUFF' || k2 === 'IK2_BUFF2' || k2 === 'IK2_SKILL' || k2 === 'IK2_TEXT' || k2 === 'IK2_WARP') {
      this.deps.inventoryService.consume(player, nId, 1);
      logger.info({ charId: player.m_idPlayer, itemId: slot.itemId, k2 }, 'use-item: charge consumed (effect ponytail)');
      return { kind: 'consumed', nId };
    }
    return { kind: 'reject' };
  }
}
