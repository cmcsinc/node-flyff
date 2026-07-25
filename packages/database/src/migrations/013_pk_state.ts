import type { Knex } from '../types';

/**
 * Add PK state columns to `characters`.
 *
 * v19 Flyff tracks player-killer state per character: `m_dwPKPropensity`
 * (IsChaotic flag > 0), `m_nPKValue` (slaughter/kill count), `m_dwPKTime`
 * (wall clock time of last PK action -- decay reference), and `m_dwPKExp`
 * (PK experience -- counter-decay accumulator). These are loaded on JOIN,
 * mutated on player-kill, decayed over time, and persisted here.
 *
 * All columns default 0 (non-PK state) so existing rows are implicitly clean.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.integer('pk_propensity').unsigned().notNullable().defaultTo(0);
    table.integer('pk_value').unsigned().notNullable().defaultTo(0);
    table.bigint('pk_time').notNullable().defaultTo(0);
    table.integer('pk_exp').unsigned().notNullable().defaultTo(0);
  });
}

/**
 * Reverse -- drop the PK columns.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('pk_exp');
    table.dropColumn('pk_time');
    table.dropColumn('pk_value');
    table.dropColumn('pk_propensity');
  });
}