import type { Knex } from '../types';

/**
 * Per-tab bank gold.
 *
 * v19 banks carry 3 independent gold pools -- one per tab -- and the wire
 * protocol carries `BYTE nSlot` (tab) on PUTGOLDBANK / GETGOLDBANK
 * (`DPSrvr.cpp:3848/3900`). The entity already models `m_BankGold[3]`
 * (`player.ts:255`) and the JOIN snapshot already writes all three to the
 * client (`mover.serializer.ts:144` writes `m_dwGoldBank *3`). Before this
 * migration only tab 0 was persisted: a relog wiped tabs 1 and 2, and the
 * bank service funneled every gold move through `m_BankGold[0]`.
 *
 * Adds `gold_tab1` + `gold_tab2` to the `bank` container row (migration 008
 * created the table with `gold` = tab 0). Tab 0 stays the existing `gold`
 * column so no data movement is needed -- the new columns default to 0 and
 * are populated lazily by `BankRepository.setGold`. Per rule
 * `11-database-normalization.md`, the container's scalar state stays on the
 * container table, never the owner.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  // ADD COLUMN is in-place (no table rebuild, no nested transaction), so the
  // raw statement is safe under better-sqlite3 + the migration runner's outer
  // transaction. See migration 008 for the DROP COLUMN caveat that forces raw.
  await db['raw'](
    'ALTER TABLE bank ADD COLUMN gold_tab1 BIGINT NOT NULL DEFAULT 0',
  );
  await db['raw'](
    'ALTER TABLE bank ADD COLUMN gold_tab2 BIGINT NOT NULL DEFAULT 0',
  );
}

/**
 * Reverse -- drop the per-tab gold columns. Tab 0 (`gold`) is untouched.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db['raw']('ALTER TABLE bank DROP COLUMN gold_tab2');
  await db['raw']('ALTER TABLE bank DROP COLUMN gold_tab1');
}
