import type { Knex } from '../types';

/**
 * Per-character unspent stat points (`characters.remain_gp`).
 *
 * C++ `m_nRemainGP` (growth points) -- the spendable stat-point pool the client
 * allocates via `PACKETTYPE_MODIFY_STATUS` (`DPSrvr::OnModifyStatus`,
 * `DPSrvr.cpp:10345`). Granted on level-up from `EXPCHARACTER.dwLPPoint`
 * (`_Common/Mover.cpp:1601`), spent 1:1 into STR/STA/DEX/INT.
 *
 * Nullable for the migration only (existing rows had no column); `CPlayer`
 * falls back to 0. The seed character starts at 0 -- points accrue on level-up.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table) => {
    table.integer('remain_gp').notNullable().defaultTo(0);
  });
}

/**
 * Reverse -- drop the column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table) => {
    table.dropColumn('remain_gp');
  });
}
