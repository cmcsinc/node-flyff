/**
 * RepairItem service -- `CDPSrvr::OnRepairItem` (DPSrvr.cpp:4949).
 *
 * Bulk-repairs every passed inventory slot to full durability for a gold cost.
 * Per-item C++ formula (`User.cpp:OnRepairItem` + `MoverAttack.cpp`):
 *
 *   nRepair = 100 - (m_nHitPoint * 100) / dwEndurance   // percent missing
 *   cost   = nRepair * (dwCost / 1000 + 1)              // dwCost = item base value
 *
 * `m_nHitPoint >= dwEndurance` -> nRepair 0 -> skipped (already full).
 * Indestructible items (`slot.durability === -1`) are skipped.
 *
 * On success: debits gold via the `spendGold` callback (WAL via InventoryService),
 * journals each repaired slot's absolute end-state as `INVENTORY_SLOT` (idempotent
 * replayer), then persists via `inventoryRepo.setItem`.
 *
 * ponytail: dwCost (per-item repair multiplier) is not yet exposed on the
 * resource schema; we approximate `dwCost/1000+1` as `(max/1000+1)` scaled by
 * `REPAIR_COST_PER_PERCENT`. Swap to `getItem(id).repairCost` when the loader
 * exposes it. Group-discount for bulk repair is also deferred.
 *
 * @module services/repair
 */

import type { Journal, InventoryRepository } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'repair-service' });

/** Penya per missing-durability percent before the dwCost multiplier. */
const REPAIR_COST_PER_PERCENT = 10;

export interface RepairedSlot {
  slot: number;
  objid: number;
  durability: number;
}

export type RepairResult =
  | { ok: true; cost: number; repaired: RepairedSlot[] }
  | { ok: false; reason: 'empty' | 'insufficient_gold'; cost?: number };

export interface RepairServiceDeps {
  inventoryRepo: InventoryRepository;
  journal: Journal;
  getItem: (id: number) => { durability?: number } | undefined;
  /** Debit gold; returns false if the player cannot afford it. WAL + persist
   * wired by InventoryService.spendGold. */
  spendGold: (player: CPlayer, amount: number) => boolean;
}

export class RepairService {
  constructor(private readonly deps: RepairServiceDeps) {}

  repair(player: CPlayer, slots: number[]): RepairResult {
    const plan: { slot: number; max: number; cost: number; objid: number }[] = [];
    let total = 0;
    for (const slot of slots) {
      const s = player.m_Inventory[slot];
      if (!s) continue;
      if (s.durability === undefined || s.durability === -1) continue; // indestructible
      const max = this.maxDurability(s.itemId);
      if (max <= 0 || s.durability >= max) continue;
      const nRepair = 100 - Math.floor((s.durability * 100) / max);
      if (nRepair <= 0) continue;
      const cost = nRepair * (Math.floor(max / 1000) + 1) * REPAIR_COST_PER_PERCENT;
      plan.push({ slot, max, cost, objid: s.objid });
      total += cost;
    }
    if (plan.length === 0) return { ok: false, reason: 'empty' };
    if (!this.deps.spendGold(player, total)) {
      return { ok: false, reason: 'insufficient_gold', cost: total };
    }
    const repaired: RepairedSlot[] = [];
    for (const p of plan) {
      const s = player.m_Inventory[p.slot];
      if (!s) continue;
      s.durability = p.max;
      // WAL -- absolute end-state, idempotent replay (see journalReplayers).
      this.deps.journal.append({
        charId: player.m_idPlayer, type: 'INVENTORY_SLOT',
        payload: { slot: p.slot, itemId: s.itemId, count: s.count, durability: p.max },
      });
      repaired.push({ slot: p.slot, objid: p.objid, durability: p.max });
      this.deps.inventoryRepo
        .setItem(player.m_idPlayer, p.slot, s.itemId, s.count, s.flags ?? 0, p.max, s.refine ?? 0)
        .catch((err: unknown) => { logger.warn({ err, charId: player.m_idPlayer, slot: p.slot }, 'repair setItem failed'); });
    }
    player._dirty.add('m_Inventory');
    return { ok: true, cost: total, repaired };
  }

  private maxDurability(itemId: number): number {
    return this.deps.getItem(itemId)?.durability ?? 0;
  }
}

/** Re-export so consumers don't depend on @flyff/resources directly. */
export type { ItemDefinition };
