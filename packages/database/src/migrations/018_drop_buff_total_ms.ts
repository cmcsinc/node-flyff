import type { Knex } from '../types';

/**
 * Drop the superseded `character_buffs.total_ms` column.
 *
 * Migration `016` added `expires_at_ms` and dropped `total_ms` together, gated
 * on `hasColumn('character_buffs','expires_at_ms')`. On databases where the
 * table was created with `expires_at_ms` already present (the admin-side mirror
 * of `015` creates it that way), that gate reads "already done" and `016` never
 * runs, leaving `total_ms INTEGER NOT NULL` with no default. Every insert from
 * the current write path, which only supplies `expires_at_ms`, then fails with
 * `SQLITE_CONSTRAINT_NOTNULL`.
 *
 * This migration is the repair: drop the column if it is still there.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  if (!(await db.schema.hasColumn('character_buffs', 'total_ms'))) return;
  await db.schema.alterTable('character_buffs', (table) => {
    table.dropColumn('total_ms');
  });
}

/**
 * Reverse - re-add `total_ms` with a default so existing rows stay valid.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  // `016.down` also re-adds `total_ms`; a full rollback runs both, so this must
  // be a no-op when the column is already back (mirrors the guard in `up`).
  if (await db.schema.hasColumn('character_buffs', 'total_ms')) return;
  await db.schema.alterTable('character_buffs', (table) => {
    table.integer('total_ms').unsigned().notNullable().defaultTo(0);
  });
}
