/**
 * QuestInventory adapter -- binds a {@link CPlayer} to a real {@link InventoryService}
 * behind the {@link QuestInventory} contract the begin/end evaluators consume.
 *
 * The evaluator interface is player-less (`count(id)` / `emptySlots()` / `add` /
 * `remove`), but `InventoryService` takes the player per call. This factory
 * captures the player once and proxies every call, so {@link QuestService} can
 * pass a single `QuestInventory` into `canBegin` / `isComplete` / `applyBeginSet`
 * / `applyEnd` exactly as before.
 *
 * Item-reward notify frames (CREATEITEM for a new slot, UPDATE_ITEM for a
 * stack-merge or a removal) are captured into the returned `frames` array so the
 * service can fan them back to the handler alongside the SETQUEST frame -- reward
 * items appear in the client bag immediately, not on next JOIN. Removals journal
 * through `InventoryService.consume` (ITEM_CONSUME), which also closes the old
 * "no WAL for quest item rewards" gap.
 *
 * @module services/questInventory
 */

import type { InventoryService } from '@flyff/inventory';
import type { CPlayer } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/world-core';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';
import { buildUpdateItemCount } from '@flyff/inventory';
import type { InventoryOps } from './questConditions';

/** Quest-side inventory: evaluator reads + reward grantor writes. */
export type QuestInventory = InventoryOps & {
  add(itemId: number, count: number): void;
  remove(itemId: number, count: number): void;
};

export interface QuestInventoryAdapterDeps {
  inventoryService: InventoryService;
  createItemSerializer: CreateItemSnapshotSerializer;
}

/**
 * Bind `player` to its real inventory. Every add/remove pushes the matching
 * notify frame into `frames`; the caller flushes them after the reward pass.
 */
export function bindQuestInventory(
  player: CPlayer,
  deps: QuestInventoryAdapterDeps,
): { inventory: QuestInventory; frames: Buffer[] } {
  const frames: Buffer[] = [];
  const inventory: QuestInventory = {
    count: (itemId) => countItem(player, itemId),
    emptySlots: () => countEmpty(player),
    add: (itemId, count) => {
      const r = deps.inventoryService.addItem(player, itemId, count);
      if (!r.ok) return; // bag full / invalid -> reward silently dropped (mirrors tracker)
      for (const ch of r.changes) {
        frames.push(
          ch.isNew
            ? deps.createItemSerializer.buildOne(player.m_idPlayer, ch.itemId, ch.count, ch.objid)
            : buildUpdateItemCount(player.m_idPlayer, ch.objid, ch.count),
        );
      }
    },
    remove: (itemId, count) => removeFromBag(player, deps.inventoryService, itemId, count, frames),
  };
  return { inventory, frames };
}

/** Remove up to `count` of `itemId` across the main bag, emitting UPDATE_ITEM per slot. */
function removeFromBag(
  player: CPlayer,
  svc: InventoryService,
  itemId: number,
  count: number,
  frames: Buffer[],
): void {
  let remaining = count;
  for (let i = 0; i < MAX_INVENTORY && remaining > 0; i++) {
    const s = player.m_Inventory[i];
    if (!s || s.itemId !== itemId) continue;
    const take = Math.min(remaining, s.count);
    const after = svc.consume(player, i, take);
    frames.push(buildUpdateItemCount(player.m_idPlayer, i, after ? Math.max(0, after.count) : 0));
    remaining -= take;
  }
}

/** Total count of `itemId` across the main bag (SetEndCondItem / SetBeginCondItem). */
function countItem(player: CPlayer, itemId: number): number {
  let n = 0;
  for (let i = 0; i < MAX_INVENTORY; i++) {
    const s = player.m_Inventory[i];
    if (s && s.itemId === itemId) n += s.count;
  }
  return n;
}

/** Free main-bag slots (SetBeginSetAddItem space gate). */
function countEmpty(player: CPlayer): number {
  let n = 0;
  for (let i = 0; i < MAX_INVENTORY; i++) if (player.m_Inventory[i] === null) n++;
  return n;
}
