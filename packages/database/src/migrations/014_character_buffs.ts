import type { Knex } from '../types';

/**
 * Per-character active timed buffs (`characters.buffs`).
 *
 * **SUPERSEDED by migration 015** (`character_buffs` table). This migration
 * added a JSON column; 015 normalizes it to a proper 1:N table per rule
 * `11-database-normalization.md`. Kept for forward-compat on existing DBs
 * (the column is dropped by 015's `up()`).
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table) => {
    table.text('buffs').nullable().defaultTo(null);
  });
}

/**
 * Reverse -- drop the column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table) => {
    table.dropColumn('buffs');
  });
}
