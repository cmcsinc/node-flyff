/**
 * Boot-time replay handlers for the WAL journal — the other half of
 * {@link JournalReplayer}. One handler per DB write surface, registered in
 * `compose.ts` before the TCP listener opens.
 *
 * Every handler is **idempotent**: the matching service journals the ABSOLUTE
 * end-state of the field it mutates (level+exp, gold total, per-slot item),
 * never a delta. Replaying N rows for the same char/field in id order just
 * overwrites with progressively newer absolute values, so the final DB state
 * equals the last row — re-applying the same journal cannot dupe or roll back.
 * This is what makes fire-and-forget persists safe: a crash between the journal
 * append and the DB write loses nothing (the row replayed on next boot), and a
 * crash AFTER the DB write is a redundant overwrite (same absolute value).
 *
 * Payloads are internal (written by our own services) and JSON-encoded in the
 * journal row; handlers parse with `JSON.parse` and let a corrupt row throw —
 * {@link JournalReplayer.recover} aborts on throw so an operator investigates
 * rather than silently dropping the row.
 *
 * @module systems/journalReplayers
 */

import type { CharacterRepository, InventoryRepository, JournalRow } from '@flyff/database';
import type { Logger } from '@flyff/core';
import type { JournalReplayer } from './journalReplayer.js';

export interface ReplayerRegistryDeps {
  readonly charRepo: Pick<CharacterRepository, 'updateLevelAndExp' | 'updateGold'>;
  readonly inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  readonly logger: Logger;
}

/** Parse a journal row's JSON payload. Throws on corrupt JSON (abort recovery). */
function payload<T>(row: JournalRow): T {
  return JSON.parse(row.payload) as T;
}

/**
 * Register the canonical replay handlers. One call from `compose.ts` covers
 * every WAL event type the services emit today.
 */
export function registerReplayers(r: JournalReplayer, deps: ReplayerRegistryDeps): void {
  // Character level + cumulative exp (DB `exp` column = `m_nExp1`).
  r.register('CHAR_EXP', async (row) => {
    const p = payload<{ level: number; exp: string }>(row);
    await deps.charRepo.updateLevelAndExp(row.char_id, p.level, BigInt(p.exp));
  });

  // Character gold total (C++ `m_nGold`).
  r.register('CHAR_GOLD', async (row) => {
    const p = payload<{ gold: number }>(row);
    await deps.charRepo.updateGold(row.char_id, p.gold);
  });

  // One inventory slot's absolute contents. `itemId: 0` ⇒ slot cleared.
  r.register('INVENTORY_SLOT', async (row) => {
    const p = payload<{ slot: number; itemId: number; count: number }>(row);
    if (p.itemId === 0) {
      await deps.inventoryRepo.removeItem(row.char_id, p.slot);
    } else {
      await deps.inventoryRepo.setItem(row.char_id, p.slot, p.itemId, p.count);
    }
  });

  deps.logger.debug({ types: ['CHAR_EXP', 'CHAR_GOLD', 'INVENTORY_SLOT'] }, 'Journal replay handlers registered');
}
