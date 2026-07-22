/**
 * EquipService -- equip/unequip slot moves + validation.
 *
 * Ports `CUser::DoUseEquipmentItem` / `CMover::EquipItem` (`_Common/MoverEquip.
 * cpp:2557/2587`) + `CItemContainer::UnEquip` (`Item.h:571`). Equipping an item
 * moves it from main-bag slot `nId` to the equip slot `MAX_INVENTORY + parts`;
 * unequipping reverses into the first empty main-bag slot. Both journal +
 * persist before the handler sends the DOEQUIP snapshot.
 *
 * Stat recompute is implicit -- `playerCombatant` reads the equip slots every
 * swing via `sumEquipStats`, so no cache invalidation (rule 05).
 *
 * ponytail: refine option encoding, jewelry HR/ER, two-handed offhand block,
 * job/level/gender requirement enforcement (level gated below; full set TODO).
 *
 * @module services/equip
 */

import type { InventoryRepository, Journal } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger.js';
import type { CPlayer, InventorySlot } from '../entities/player.js';
import { MAX_INVENTORY, MAX_HUMAN_PARTS } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'equip-service' });
const PARTS_RIDE = 13; // __HACK_1023 ride-speed slot -- reject for now

export interface EquipServiceDeps {
  inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  getItem: (itemId: number) => ItemDefinition | undefined;
  journal?: Journal;
}

export type EquipResult =
  | { ok: true; parts: number; itemId: number; invSlot: number }
  | { ok: false; reason: 'invalid' | 'not_equippable' | 'bag_full' | 'restricted' };

export type UnequipResult =
  | { ok: true; parts: number; itemId: number; invSlot: number }
  | { ok: false; reason: 'invalid' | 'bag_full' | 'not_equipped' };

export class EquipService {
  constructor(private readonly deps: EquipServiceDeps) {}

  /**
   * Equip the item in main-bag `invSlot`. `parts` comes from the client
   * (DOEQUIP nPart) -- it MUST match the item's own `equip_slot`, else reject
   * (anti-cheat). Swaps the equipped item back into `invSlot` if the slot was
   * occupied. Returns the parts for the DOEQUIP broadcast.
   */
  equip(player: CPlayer, invSlot: number, parts: number): EquipResult {
    if (!this.inMainBag(invSlot) || parts <= 0 || parts >= MAX_HUMAN_PARTS) return { ok: false, reason: 'invalid' };
    if (parts === PARTS_RIDE) return { ok: false, reason: 'restricted' };
    const item = player.m_Inventory[invSlot];
    if (!item) return { ok: false, reason: 'invalid' };
    const prop = this.deps.getItem(item.itemId);
    const equipSlot = prop?.equip_slot;
    if (!equipSlot || equipSlot !== parts) return { ok: false, reason: 'not_equippable' };
    if (prop.level_req && player.m_nLevel < prop.level_req) return { ok: false, reason: 'restricted' };

    const equipIdx = MAX_INVENTORY + parts;
    const prev = player.m_Inventory[equipIdx] ?? null;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'ITEM_EQUIP', payload: { invSlot, equipIdx, itemId: item.itemId } });
    player.m_Inventory[equipIdx] = item;
    player.m_Inventory[invSlot] = prev;
    player._dirty.add('m_Inventory');
    this.persistSlot(player, equipIdx, item);
    if (prev) this.persistSlot(player, invSlot, prev);
    else this.deps.inventoryRepo.removeItem(player.m_idPlayer, invSlot).catch((e: unknown) => logger.warn({ err: e }, 'equip removeItem failed'));
    return { ok: true, parts, itemId: item.itemId, invSlot };
  }

  /** Unequip `parts` back into the first empty main-bag slot. */
  unequip(player: CPlayer, parts: number): UnequipResult {
    if (parts <= 0 || parts >= MAX_HUMAN_PARTS) return { ok: false, reason: 'invalid' };
    const equipIdx = MAX_INVENTORY + parts;
    const item = player.m_Inventory[equipIdx];
    if (!item) return { ok: false, reason: 'not_equipped' };
    const dst = this.findEmpty(player);
    if (dst === -1) return { ok: false, reason: 'bag_full' };

    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'ITEM_UNEQUIP', payload: { equipIdx, invSlot: dst, itemId: item.itemId } });
    player.m_Inventory[equipIdx] = null;
    player.m_Inventory[dst] = item;
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo.removeItem(player.m_idPlayer, equipIdx).catch((e: unknown) => logger.warn({ err: e }, 'unequip remove equipSlot failed'));
    this.persistSlot(player, dst, item);
    return { ok: true, parts, itemId: item.itemId, invSlot: dst };
  }

  private inMainBag(slot: number): boolean {
    return slot >= 0 && slot < MAX_INVENTORY;
  }

  private findEmpty(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      if (player.m_Inventory[i] === null) return i;
    }
    return -1;
  }

  private persistSlot(player: CPlayer, slot: number, s: InventorySlot): void {
    this.deps.inventoryRepo
      .setItem(player.m_idPlayer, slot, s.itemId, s.count, s.flags ?? 0, s.durability ?? -1, s.refine ?? 0)
      .catch((e: unknown) => logger.warn({ err: e, slot }, 'equip setItem failed'));
  }
}
