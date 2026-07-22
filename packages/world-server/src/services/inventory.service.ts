/**
 * InventoryService -- bag mutations (pickup, move, drop, consume) + gold.
 *
 * Ports the `CInventory` mutation surface used by the loot / MOVEITEM / DROPITEM
 * / DROPGOLD / DOUSEITEM handlers (`_Common/MoverActEvent.cpp:2575`,
 * `Item.h:660 Add`, `WORLDSERVER/DPSrvr.cpp:787/813/841`). Pure state mutation +
 * WAL + fire-and-forget persist; the handler owns wire framing (CREATEITEM /
 * UPDATE_ITEM / DEL_OBJ / SETPOINTPARAM).
 *
 * Ordering (rule 03/04 -- WAL before ack): validate -> journal -> mutate ->
 * fire-and-forget persist. Handlers send the success snapshot only after an
 * `{ ok: true }` return.
 *
 * Stacking (`Item.h:687`): merge only if itemId + flags match AND count <
 * `stack_size` (propItem `dwPackMax`). addItem merges onto one partial stack
 * first, else takes a fresh empty slot.
 *
 * Slot layout: 0..MAX_INVENTORY-1 (42) = main bag; 42..72 = equip parts. These
 * methods operate on the main bag only; equip-slot moves are `EquipService`.
 *
 * @module services/inventory
 */

import type { InventoryRepository, CharacterRepository, Journal } from '@flyff/database';
import { MAX_GOLD } from '@flyff/core';
import { createLogger } from '@flyff/core/logger.js';
import type { CPlayer, InventorySlot, Vec3 } from '../entities/player.js';
import { MAX_INVENTORY } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'inventory-service' });

export interface InventoryServiceDeps {
  inventoryRepo: Pick<
    InventoryRepository,
    'setItem' | 'removeItem' | 'updateQuantity' | 'moveItem'
  >;
  charRepo: Pick<CharacterRepository, 'updateGold'>;
  /** Stack-size lookup (propItem dwPackMax via resources). Default 1 if absent. */
  getStackSize?: (itemId: number) => number;
  /** WAL journal -- optional so tests can omit it. */
  journal?: Journal;
}

export type AddItemResult =
  | { ok: true; slot: number; itemId: number; count: number; isNew: boolean }
  | { ok: false; reason: 'bag_full' | 'invalid' };

export type MoveItemResult =
  | { ok: true; src: number; dst: number }
  | { ok: false; reason: 'invalid' };

export type DropItemResult =
  | { ok: true; itemId: number; count: number; pos: Vec3 }
  | { ok: false; reason: 'invalid' };

export type DropGoldResult =
  | { ok: true; amount: number; pos: Vec3 }
  | { ok: false; reason: 'invalid' };

export class InventoryService {
  constructor(private readonly deps: InventoryServiceDeps) {}

  /**
   * Place `count` of `itemId`. Stacking-aware: if a partial stack of the same
   * id+flags exists below `stack_size`, merge into it (isNew=false -> handler
   * sends UPDATE_ITEM); otherwise claim a fresh empty slot (isNew=true ->
   * CREATEITEM). Returns `bag_full` so the handler can leave the pile lootable.
   */
  addItem(player: CPlayer, itemId: number, count: number): AddItemResult {
    if (count <= 0) return { ok: false, reason: 'invalid' };
    const stackSize = this.stackSize(itemId);

    if (stackSize > 1) {
      for (let i = 0; i < MAX_INVENTORY; i++) {
        const s = player.m_Inventory[i];
        if (s && s.itemId === itemId && (s.flags ?? 0) === 0 && s.count < stackSize) {
          const add = Math.min(count, stackSize - s.count);
          this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: i, itemId, count: s.count + add } });
          s.count += add;
          player._dirty.add('m_Inventory');
          this.persist(player, i, s);
          return { ok: true, slot: i, itemId, count: s.count, isNew: false };
        }
      }
    }

    const slot = this.findEmpty(player);
    if (slot === -1) return { ok: false, reason: 'bag_full' };
    const placed: InventorySlot = { itemId, count: Math.min(count, Math.max(1, stackSize)) };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot, itemId, count: placed.count } });
    player.m_Inventory[slot] = placed;
    player._dirty.add('m_Inventory');
    this.persist(player, slot, placed);
    return { ok: true, slot, itemId, count: placed.count, isNew: true };
  }

  /** Swap two main-bag slots (v15 MOVEITEM is a pure swap; no split opcode). */
  moveItem(player: CPlayer, src: number, dst: number): MoveItemResult {
    if (src === dst || !this.inMainBag(src) || !this.inMainBag(dst)) return { ok: false, reason: 'invalid' };
    const a = player.m_Inventory[src];
    if (!a) return { ok: false, reason: 'invalid' };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'ITEM_MOVE', payload: { src, dst } });
    const b = player.m_Inventory[dst] ?? null;
    player.m_Inventory[src] = b;
    player.m_Inventory[dst] = a;
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo
      .moveItem(player.m_idPlayer, src, dst)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, src, dst }, 'inventory moveItem failed'));
    return { ok: true, src, dst };
  }

  /** Remove `count` from `slot` for a ground drop; returns the drop payload. */
  dropItem(player: CPlayer, slot: number, count: number, pos: Vec3): DropItemResult {
    if (!this.inMainBag(slot)) return { ok: false, reason: 'invalid' };
    const s = player.m_Inventory[slot];
    if (!s || count <= 0) return { ok: false, reason: 'invalid' };
    const take = Math.min(count, s.count);
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'ITEM_DROP', payload: { slot, itemId: s.itemId, take } });
    if (take >= s.count) {
      player.m_Inventory[slot] = null;
      this.deps.inventoryRepo
        .removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory removeItem failed'));
    } else {
      s.count -= take;
      this.persist(player, slot, s);
    }
    player._dirty.add('m_Inventory');
    return { ok: true, itemId: s.itemId, count: take, pos };
  }

  /** Remove `amount` gold for a ground penya drop. Rejects over-spend. */
  dropGold(player: CPlayer, amount: number, pos: Vec3): DropGoldResult {
    if (amount <= 0 || amount > player.m_nGold) return { ok: false, reason: 'invalid' };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'GOLD_DROP', payload: { amount } });
    player.m_nGold -= amount;
    player._dirty.add('m_nGold');
    this.deps.charRepo
      .updateGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'));
    return { ok: true, amount, pos };
  }

  /** Credit `amount` penya, clamped to MAX_GOLD (rule 03 -- gold overflow). */
  addGold(player: CPlayer, amount: number): void {
    if (amount <= 0) return;
    const before = player.m_nGold;
    player.m_nGold = Math.min(MAX_GOLD, before + amount);
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold } });
    player._dirty.add('m_nGold');
    this.deps.charRepo
      .updateGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'));
  }

  /** Consume `count` from `slot` (scrolls/potions). Returns the post-consume slot or null. */
  consume(player: CPlayer, slot: number, count = 1): InventorySlot | null {
    if (!this.inMainBag(slot)) return null;
    const s = player.m_Inventory[slot];
    if (!s || s.count < count) return null;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'ITEM_CONSUME', payload: { slot, itemId: s.itemId, take: count } });
    s.count -= count;
    if (s.count <= 0) {
      player.m_Inventory[slot] = null;
      this.deps.inventoryRepo
        .removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory removeItem failed'));
    } else {
      this.persist(player, slot, s);
    }
    player._dirty.add('m_Inventory');
    return s;
  }

  private inMainBag(slot: number): boolean {
    return slot >= 0 && slot < MAX_INVENTORY;
  }

  private stackSize(itemId: number): number {
    return Math.max(1, this.deps.getStackSize?.(itemId) ?? 1);
  }

  private findEmpty(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      if (player.m_Inventory[i] === null) return i;
    }
    return -1;
  }

  private persist(player: CPlayer, slot: number, s: InventorySlot): void {
    this.deps.inventoryRepo
      .setItem(player.m_idPlayer, slot, s.itemId, s.count, s.flags ?? 0, s.durability ?? -1, s.refine ?? 0)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory setItem failed'));
  }
}
