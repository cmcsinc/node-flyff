/**
 * Boot-time replay handlers for the WAL journal -- the other half of
 * {@link JournalReplayer}. One handler per DB write surface, registered in
 * `compose.ts` before the TCP listener opens.
 *
 * Every handler is **idempotent**: the matching service journals the ABSOLUTE
 * end-state of the field it mutates (level+exp, gold total, per-slot item),
 * never a delta. Replaying N rows for the same char/field in id order just
 * overwrites with progressively newer absolute values, so the final DB state
 * equals the last row -- re-applying the same journal cannot dupe or roll back.
 * This is what makes fire-and-forget persists safe: a crash between the journal
 * append and the DB write loses nothing (the row replayed on next boot), and a
 * crash AFTER the DB write is a redundant overwrite (same absolute value).
 *
 * Payloads are internal (written by our own services) and JSON-encoded in the
 * journal row; handlers parse with `JSON.parse` and let a corrupt row throw --
 * {@link JournalReplayer.recover} aborts on throw so an operator investigates
 * rather than silently dropping the row.
 *
 * @module systems/journalReplayers
 */

import type { CharacterRepository, InventoryRepository, BankRepository, SkillRepository, JournalRow } from '@flyff/database';
import type { Logger } from '@flyff/core';
import type { JournalReplayer } from './journalReplayer';

export interface ReplayerRegistryDeps {
  readonly charRepo: Pick<CharacterRepository, 'updateLevelAndExp' | 'updateStats' | 'updateSkillPoints' | 'updateClass'>;
  readonly inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem' | 'setGold'>;
  readonly bankRepo: Pick<BankRepository, 'setBankPass'>;
  readonly skillRepo: Pick<SkillRepository, 'saveAll'>;
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

  // Character gold total (C++ `m_nGold`) -- stored on the inventory container
  // row (migration 008), not the character row.
  r.register('CHAR_GOLD', async (row) => {
    const p = payload<{ gold: number }>(row);
    await deps.inventoryRepo.setGold(row.char_id, p.gold);
  });

  // One inventory slot's absolute contents. `itemId: 0` => slot cleared.
  // `refine`/`element`/`element_level` optional for back-compat with rows
  // written before migration 012 (they default 0 -- plain item, same as before).
  r.register('INVENTORY_SLOT', async (row) => {
    const p = payload<{
      slot: number; itemId: number; count: number;
      flags?: number; durability?: number; refine?: number;
      element?: number; element_level?: number;
    }>(row);
    if (p.itemId === 0) {
      await deps.inventoryRepo.removeItem(row.char_id, p.slot);
    } else {
      await deps.inventoryRepo.setItem(
        row.char_id, p.slot, p.itemId, p.count,
        p.flags ?? 0, p.durability ?? -1, p.refine ?? 0,
        undefined, p.element ?? 0, p.element_level ?? 0,
      );
    }
  });

  // Account-wide bank password (C++ `m_szBankPass`). Stored on the bank
  // container row (migration 008); payload carries accountId to address it.
  // '0000' = cleared.
  r.register('BANK_PASS', async (row) => {
    const p = payload<{ accountId: number; bankPass: string }>(row);
    await deps.bankRepo.setBankPass(p.accountId, p.bankPass);
  });

  // Absolute stat block + unspent stat points (C++ m_nStr/Sta/Dex/Int/RemainGP).
  // Emitted by StatService on allocation; absolute so replay is idempotent.
  r.register('CHAR_STATS', async (row) => {
    const p = payload<{
      strength: number; stamina: number; dexterity: number; intelligence: number; remain_gp: number;
    }>(row);
    await deps.charRepo.updateStats(row.char_id, p);
  });

  // Absolute job-skill roster + unspent SP (C++ m_aJobSkill/m_nSkillPoint).
  // Emitted by SkillService.learnSkills; absolute (whole roster) so replay is
  // idempotent. saveAll delete+reinserts the whole set, matching the payload.
  r.register('SKILL_LEARN', async (row) => {
    const p = payload<{
      roster: Array<{ slot: number; skillId: number; level: number }>;
      skillPoint: number; skillLevel: number;
    }>(row);
    await deps.skillRepo.saveAll(row.char_id, p.roster);
    await deps.charRepo.updateSkillPoints(row.char_id, p.skillPoint, p.skillLevel);
  });

  // Character class/job (C++ m_nJob). Emitted by ChangeJobService on AddChangeJob;
  // absolute so replay is idempotent. Persists both the job id AND the new
  // roster (AddChangeJob re-seeds m_aJobSkill for the new job's tier).
  r.register('CHAR_JOB', async (row) => {
    const p = payload<{ class: number; roster: Array<{ slot: number; skillId: number; level: number }> }>(row);
    await deps.charRepo.updateClass(row.char_id, p.class);
    await deps.skillRepo.saveAll(row.char_id, p.roster);
  });

  deps.logger.debug({ types: ['CHAR_EXP', 'CHAR_GOLD', 'INVENTORY_SLOT', 'BANK_PASS', 'CHAR_STATS', 'SKILL_LEARN', 'CHAR_JOB'] }, 'Journal replay handlers registered');
}
