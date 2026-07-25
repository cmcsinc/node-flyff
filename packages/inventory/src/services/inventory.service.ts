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

import type { InventoryRepository, Journal } from '@flyff/database';
import { MAX_GOLD } from '@flyff/core';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, InventorySlot, Vec3 } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/world-core';

const logger = createLogger({ module: 'inventory-service' });

export interface InventoryServiceDeps {
  inventoryRepo: Pick<
    InventoryRepository,
    'setItem' | 'removeItem' | 'updateQuantity' | 'moveItem' | 'setGold'
  >;
  /** Stack-size lookup (propItem dwPackMax via resources). Default 1 if absent. */
  getStackSize?: (itemId: number) => number;
  /** WAL journal -- optional so tests can omit it. */
  journal?: Journal;
}

export type AddItemResult =
  | { ok: true; slot: number; objid: number; itemId: number; count: number; isNew: boolean }
  | { ok: false; reason: 'bag_full' | 'invalid' };

export type MoveItemResult =
  | { ok: true; src: number; dst: number }
  | { ok: false; reason: 'invalid' };

export type DropItemResult =
  | { ok: true; slot: number; itemId: number; count: number; remaining: number; pos: Vec3 }
  | { ok: false; reason: 'invalid' };

export type DropGoldResult =
  | { ok: true; amount: number; pos: Vec3 }
  | { ok: false; reason: 'invalid' };

export type RemoveItemResult =
  | { ok: true; slot: number; itemId: number; remaining: number }
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
          // objid = the client's stable m_dwObjId for this slot (drifts from the
          // slot index once items cross the bag/equip boundary). UPDATE_ITEM /
          // CREATEITEM must address by it, not the raw slot -- see clientObjId.
          return { ok: true, slot: i, objid: s.objid ?? player.clientObjId(i), itemId, count: s.count, isNew: false };
        }
      }
    }

    const slot = this.findEmpty(player);
    if (slot === -1) return { ok: false, reason: 'bag_full' };
    // m_dwObjId MUST equal the client's m_apIndex[slot] for CREATEITEM to render
    // (SetAtId writes m_apItem[objid]; the grid draws m_apItem[m_apIndex[slot]]).
    // After unequip->sell this is the stale equip objid, not the slot index.
    // Mirrors vanilla CItemContainer::Add (Item.h:727: m_dwObjId = m_apIndex[i]).
    const placed: InventorySlot = { objid: player.clientObjId(slot), itemId, count: Math.min(count, Math.max(1, stackSize)) };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot, itemId, count: placed.count } });
    player.m_Inventory[slot] = placed;
    player._dirty.add('m_Inventory');
    this.persist(player, slot, placed);
    // objid = clientObjId(slot): the client renders a CREATEITEM at the slot
    // whose m_apIndex equals this objid (C++ Add uses nId = m_apIndex[i],
    // Item.h:720), NOT the raw bag index. After equipping out of a slot the two
    // diverge -- addressing by slot lands the new item in the equipped item's
    // cell (weapon-in-shield-slot bug). placed.objid already carries this.
    return { ok: true, slot, objid: placed.objid, itemId, count: placed.count, isNew: true };
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
    // Mirror CItemContainer::Swap -- m_apIndex entries travel with the items, so
    // future CREATEITEM objids stay aligned with the client's grid after swaps.
    player.onInvSlotsSwapped(src, dst);
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
    const remaining = s.count - take;
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
    return { ok: true, slot, itemId: s.itemId, count: take, remaining, pos };
  }

  /**
   * Destroy `count` from main-bag `slot` (v15 REMOVEINVENITEM -- right-click
   * "Delete" / drag-to-trash). No ground pile; the item ceases to exist.
   * Mirrors `CDPSrvr::OnRemoveInvenItem` (`DPSrvr.cpp:8350`): non-positive
   * count, equipped slot, and insufficient stack are rejected silently.
   * Journal is canonical `INVENTORY_SLOT` absolute end-state (itemId 0 =>
   * cleared) so crash recovery is idempotent. ponytail: `IsUndestructable` +
   * `IsUsing` gates (item flags / in-use state not tracked yet) and the
   * DEFINEDTEXT success text -- add when propItem flags + the text frame ship.
   */
  removeItem(player: CPlayer, slot: number, count: number): RemoveItemResult {
    if (!this.inMainBag(slot)) return { ok: false, reason: 'invalid' };
    const s = player.m_Inventory[slot];
    if (!s || count <= 0 || count > s.count) return { ok: false, reason: 'invalid' };
    const itemId = s.itemId;
    const remaining = s.count - count;
    if (remaining <= 0) {
      this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot, itemId: 0, count: 0 } });
      player.m_Inventory[slot] = null;
      this.deps.inventoryRepo
        .removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory removeItem failed'));
    } else {
      s.count = remaining;
      this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot, itemId, count: remaining } });
      this.persist(player, slot, s);
    }
    player._dirty.add('m_Inventory');
    return { ok: true, slot, itemId, remaining: Math.max(0, remaining) };
  }

  /** Remove `amount` gold for a ground penya drop. Rejects over-spend. */
  dropGold(player: CPlayer, amount: number, pos: Vec3): DropGoldResult {
    if (amount <= 0 || amount > player.m_nGold) return { ok: false, reason: 'invalid' };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'GOLD_DROP', payload: { amount } });
    player.m_nGold -= amount;
    player._dirty.add('m_nGold');
    this.deps.inventoryRepo
      .setGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'));
    return { ok: true, amount, pos };
  }

  /**
   * Debit `amount` penya. Returns false if `amount` is non-positive or exceeds
   * the current balance (no mutation). Mirrors {@link addGold}'s WAL + persist;
   * used by NPC shop buy. Callers MUST pre-check gold when they need atomic
   * "no item if no gold" ordering (add the item only after this returns true,
   * or check the balance read-only before addItem to avoid a stranded item).
   */
  spendGold(player: CPlayer, amount: number): boolean {
    if (amount <= 0 || amount > player.m_nGold) return false;
    player.m_nGold -= amount;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold } });
    player._dirty.add('m_nGold');
    this.deps.inventoryRepo
      .setGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'));
    return true;
  }

  /** Credit `amount` penya, clamped to MAX_GOLD (rule 03 -- gold overflow). */
  addGold(player: CPlayer, amount: number): void {
    if (amount <= 0) return;
    const before = player.m_nGold;
    player.m_nGold = Math.min(MAX_GOLD, before + amount);
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold } });
    player._dirty.add('m_nGold');
    this.deps.inventoryRepo
      .setGold(player.m_idPlayer, player.m_nGold)
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
