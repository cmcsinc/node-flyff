import type { Knex } from '../types';

/**
 * Adds the `gold` column to `characters` (C++ `m_nGold`).
 *
 * Gold previously lived only in memory + the WAL `GOLD_CHANGE` rows; this
 * column is the cold-tier persistence so gold survives a clean restart (loaded
 * on JOIN via `CPlayer.fromRow`). Live mutations fire-and-forget `updateGold`
 * at the reward source, mirroring the combat exp path. WAL remains the
 * crash-recovery source of truth (replay wiring lands with the broader
 * replay-handler story -- exp/item have the same gap today).
 *
 * `bigInteger` unsigned -- Flyff `MAX_GOLD` (~2.1B) fits signed-32 barely;
 * unsigned bigInteger is future-proof and matches the `exp` column shape.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.bigInteger('gold').unsigned().defaultTo(0).notNullable();
  });
}

/**
 * Reverse -- drop the `gold` column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('gold');
  });
}
