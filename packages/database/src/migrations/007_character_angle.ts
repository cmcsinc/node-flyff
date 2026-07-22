import type { Knex } from '../types.js';

/**
 * Per-character facing angle (`characters.angle`).
 *
 * C++ `CMover::m_fAngle` (y-axis rotation, radians) -- updated by GETPOS /
 * `OnPlayerAngle` and read on spawn so the player re-faces where they last
 * looked. Persisted on disconnect + by the 30 s checkpoint loop so a relogin
 * or crash does not snap the player back to facing 0.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.float('angle').notNullable().defaultTo(0);
  });
}

/**
 * Reverse -- drop the column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('angle');
  });
}
