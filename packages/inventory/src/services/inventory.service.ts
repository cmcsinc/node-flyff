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

/** One slot mutation emitted by {@link InventoryService.addItem}. */
export interface AddItemChange {
  slot: number;
  objid: number;
  itemId: number;
  /** New stack count in this slot after the merge or placement. */
  count: number;
  /** `true` = fresh slot (handler sends CREATEITEM); `false` = stack merge (UPDATE_ITEM). */
  isNew: boolean;
}

export type AddItemResult =
  | { ok: true; changes: AddItemChange[] }
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
   * Place `count` of `itemId`. Two-pass algorithm matching C++
   * `CItemContainer::Add` (Item.h:687):
   *
   * 1. **Merge pass** -- scan existing partial stacks of the same itemId with
   *    `flags === 0`; fill each up to `stackSize`.
   * 2. **Empty-slot pass** -- place any remainder in fresh empty slots, each
   *    capped at `stackSize`.
   *
   * Returns `changes[]` (one entry per touched slot) so the handler can send
   * CREATEITEM / UPDATE_ITEM per slot. On `bag_full` with partial success the
   * changes placed so far are returned; only a total failure returns
   * `bag_full`.
   */
  addItem(player: CPlayer, itemId: number, count: number): AddItemResult {
    if (count <= 0) return { ok: false, reason: 'invalid' };
    const stackSize = this.stackSize(itemId);
    const changes: AddItemChange[] = [];
    let remaining = count;

    // Pass 1: merge onto existing partial stacks (C++ pElemtmp merge pass).
    if (stackSize > 1) {
      for (let i = 0; i < MAX_INVENTORY && remaining > 0; i++) {
        const s = player.m_Inventory[i];
        if (!s || s.itemId !== itemId || (s.flags ?? 0) !== 0) continue;
        const space = stackSize - s.count;
        if (space <= 0) continue;
        const add = Math.min(remaining, space);
        this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: i, itemId, count: s.count + add } });
        s.count += add;
        remaining -= add;
        this.persist(player, i, s);
        changes.push({ slot: i, objid: s.objid ?? player.clientObjId(i), itemId, count: s.count, isNew: false });
      }
    }

    // Pass 2: place remainder in empty slots (C++ empty-slot pass).
    // m_dwObjId MUST equal the client's m_apIndex[slot] for CREATEITEM to
    // render (SetAtId writes m_apItem[objid]; the grid draws
    // m_apItem[m_apIndex[slot]]). After unequip->sell this is the stale equip
    // objid, not the slot index. Mirrors vanilla CItemContainer::Add
    // (Item.h:727: m_dwObjId = m_apIndex[i]).
    while (remaining > 0) {
      const slot = this.findEmpty(player);
      if (slot === -1) {
        // bag_full -- if we already placed something, return partial success
        // so the handler sends the packets for what was placed; the caller
        // handles the bag_full separately (pile stays lootable, etc.).
        if (changes.length > 0) {
          player._dirty.add('m_Inventory');
          return { ok: true, changes };
        }
        return { ok: false, reason: 'bag_full' };
      }
      const place = Math.min(remaining, stackSize);
      const placed: InventorySlot = { objid: player.clientObjId(slot), itemId, count: place };
      this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot, itemId, count: place } });
      player.m_Inventory[slot] = placed;
      this.persist(player, slot, placed);
      remaining -= place;
      changes.push({ slot, objid: placed.objid, itemId, count: place, isNew: true });
    }

    player._dirty.add('m_Inventory');
    return { ok: true, changes };
  }

  /**
   * Move `src` onto `dst` (v19 MOVEITEM -- no split opcode).
   *
   * Ports `CItemContainer::Swap` (`Item.h:741`): NOT always a pure swap. When
   * both slots hold the same stackable item (same itemId, plain flags, no
   * keep-time, `dwPackMax > 1`), `src` pours into `dst`:
   *   - src count <= dst space  -> dst absorbs it, src slot empties.
   *   - src count >  dst space  -> dst fills to stack_size, remainder stays in src.
   * Otherwise it falls through to a pure slot swap.
   *
   * The client runs the identical merge on the `AddMoveItem` echo
   * (`DPClient.cpp:2148` -> `m_Inventory.Swap`), so the wire response is the
   * same either way -- only persistence differs. Without the merge branch the
   * DB keeps two stacks and relog reverts a client-side merge.
   */
  moveItem(player: CPlayer, src: number, dst: number): MoveItemResult {
    if (src === dst || !this.inMainBag(src) || !this.inMainBag(dst)) return { ok: false, reason: 'invalid' };
    const a = player.m_Inventory[src];
    if (!a) return { ok: false, reason: 'invalid' };
    const b = player.m_Inventory[dst];

    const stackSize = this.stackSize(a.itemId);
    if (
      b &&
      b.itemId === a.itemId &&
      (a.flags ?? 0) === 0 &&
      (b.flags ?? 0) === 0 &&
      !a.keepTime &&
      !b.keepTime &&
      stackSize > 1
    ) {
      const space = stackSize - b.count;
      if (space > 0) {
        const move = Math.min(a.count, space);
        if (move >= a.count) {
          // Src fully absorbed into dst -- dst gains the count, src empties.
          this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: dst, itemId: b.itemId, count: b.count + a.count } });
          this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: src, itemId: 0, count: 0 } });
          b.count += a.count;
          player.m_Inventory[src] = null;
          this.persist(player, dst, b);
          this.deps.inventoryRepo
            .removeItem(player.m_idPlayer, src)
            .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, slot: src }, 'inventory removeItem failed'); });
        } else {
          // Partial: dst fills to stack_size, remainder stays in src.
          this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: dst, itemId: b.itemId, count: stackSize } });
          this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: src, itemId: a.itemId, count: a.count - move } });
          b.count += move;
          a.count -= move;
          this.persist(player, dst, b);
          this.persist(player, src, a);
        }
        player._dirty.add('m_Inventory');
        return { ok: true, src, dst };
      }
    }

    // Pure slot swap (no stack merge possible). Journal the ABSOLUTE post-swap
    // contents of both slots, not the {src,dst} delta -- rule 04 / the
    // idempotency contract in `journalReplayers.ts`. A delta row cannot be
    // replayed safely (re-applying a swap undoes it) and had no replayer at all.
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: src, itemId: b?.itemId ?? 0, count: b?.count ?? 0 } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: dst, itemId: a.itemId, count: a.count } });
    player.m_Inventory[src] = b;
    player.m_Inventory[dst] = a;
    // Mirror CItemContainer::Swap2 -- m_apIndex entries travel with the items, so
    // future CREATEITEM objids stay aligned with the client's grid after swaps.
    player.onInvSlotsSwapped(src, dst);
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo
      .moveItem(player.m_idPlayer, src, dst)
      .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, src, dst }, 'inventory moveItem failed'); });
    return { ok: true, src, dst };
  }

  /** Remove `count` from `slot` for a ground drop; returns the drop payload. */
  dropItem(player: CPlayer, slot: number, count: number, pos: Vec3): DropItemResult {
    if (!this.inMainBag(slot)) return { ok: false, reason: 'invalid' };
    const s = player.m_Inventory[slot];
    if (!s || count <= 0) return { ok: false, reason: 'invalid' };
    const take = Math.min(count, s.count);
    const remaining = s.count - take;
    // Absolute post-drop slot state (itemId 0 => cleared) so WAL replay is
    // idempotent -- the old `ITEM_DROP` delta had no replayer at all.
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: remaining > 0 ? { slot, itemId: s.itemId, count: remaining } : { slot, itemId: 0, count: 0 } });
    if (take >= s.count) {
      player.m_Inventory[slot] = null;
      this.deps.inventoryRepo
        .removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory removeItem failed'); });
    } else {
      s.count -= take;
      this.persist(player, slot, s);
    }
    player._dirty.add('m_Inventory');
    return { ok: true, slot, itemId: s.itemId, count: take, remaining, pos };
  }

  /**
   * Destroy `count` from main-bag `slot` (v19 REMOVEINVENITEM -- right-click
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
        .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory removeItem failed'); });
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
    // Canonical absolute CHAR_GOLD (the old `GOLD_DROP` delta had no replayer).
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold - amount } });
    player.m_nGold -= amount;
    player._dirty.add('m_nGold');
    this.deps.inventoryRepo
      .setGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'); });
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
      .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'); });
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
      .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'); });
  }

  /** Consume `count` from `slot` (scrolls/potions). Returns the post-consume slot or null. */
  consume(player: CPlayer, slot: number, count = 1): InventorySlot | null {
    if (!this.inMainBag(slot)) return null;
    const s = player.m_Inventory[slot];
    if (!s || s.count < count) return null;
    // Absolute post-consume slot state (the old `ITEM_CONSUME` delta had no
    // replayer, so a crash mid-consume silently lost the charge).
    const left = s.count - count;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: left > 0 ? { slot, itemId: s.itemId, count: left } : { slot, itemId: 0, count: 0 } });
    s.count -= count;
    if (s.count <= 0) {
      player.m_Inventory[slot] = null;
      this.deps.inventoryRepo
        .removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory removeItem failed'); });
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

  /**
   * Would `count` of `itemId` fit right now? `CItemContainer::IsFull` as used by
   * the pet-only branch of `CMover::IsLoot` (`MoverActEvent.cpp:2313`), which
   * stops a looter pet from walking to a pile it cannot carry. Same two passes
   * as {@link addItem}: merge space on partial stacks, then empty slots.
   */
  canFit(player: CPlayer, itemId: number, count: number): boolean {
    if (count <= 0) return false;
    const stackSize = this.stackSize(itemId);
    let remaining = count;
    if (stackSize > 1) {
      for (let i = 0; i < MAX_INVENTORY && remaining > 0; i++) {
        const s = player.m_Inventory[i];
        if (!s || s.itemId !== itemId || (s.flags ?? 0) !== 0) continue;
        remaining -= Math.max(0, stackSize - s.count);
      }
    }
    for (let i = 0; i < MAX_INVENTORY && remaining > 0; i++) {
      if (player.m_Inventory[i] === null) remaining -= stackSize;
    }
    return remaining <= 0;
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
      .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory setItem failed'); });
  }
}
