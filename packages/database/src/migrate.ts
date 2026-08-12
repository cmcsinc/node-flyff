import type { Knex } from './types';

/**
 * Runs all pending database migrations.
 *
 * Migrations are applied in transaction (for supported databases)
 * and each migration file's `up()` function is executed.
 *
 * @param db - Knex instance
 * @throws If migration fails
 */
export async function runMigrations(db: Knex): Promise<void> {
  await db.migrate.latest();
}

/**
 * Rolls back the most recent batch of migrations.
 *
 * By default, rolls back one batch. Pass `step` to roll back
 * multiple batches at once.
 *
 * @param db - Knex instance
 * @param step - Number of batches to roll back (default: 1)
 * @throws If rollback fails
 */
export async function rollbackMigrations(db: Knex, step = 1): Promise<void> {
  // knex.migrate.rollback(config, all) has no step param -- one batch per call.
  for (let i = 0; i < step; i++) {
    await db.migrate.rollback(undefined, false);
  }
}

/**
 * Gets the current migration version.
 *
 * Returns the name of the most recently applied migration,
 * or `none` if no migrations have been applied.
 *
 * @param db - Knex instance
 * @returns Current migration name or 'none'
 */
export async function getCurrentMigration(db: Knex): Promise<string> {
  // Knex 3.x migrate.currentVersion() returns the version string directly
  // (not a [version, migrations] tuple). Destructuring it would yield the
  // first character -- e.g. 'n' from 'none'.
  return db.migrate.currentVersion();
}
