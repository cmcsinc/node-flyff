import type { Knex } from '../types';

/**
 * Persist buff expiry as an absolute timestamp instead of the original total
 * duration.
 *
 * Migration 015 stored `total_ms` (`IBuff::GetTotal`), so every relog re-added
 * each buff at its FULL duration — an hour-long buff never expired as long as
 * the player kept reconnecting. C++ gets away with `SaveSkillInfluence` storing
 * total because it only writes on logout and the server clock is the same
 * process; the faithful behaviour a player expects (and what `IBuff::Timeover`
 * computes from `inst + total`) is a deadline. We store the deadline directly:
 * `expires_at_ms` = absolute epoch ms, and the load path re-adds the buff with
 * `expires_at_ms - now` remaining, dropping rows that already lapsed.
 *
 * Existing rows get `0` → treated as expired on next load (one-time loss of
 * in-flight buffs at migration time; buffs are ephemeral by nature).
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('character_buffs', (table) => {
    table.integer('expires_at_ms').notNullable().defaultTo(0);
  });
  await db.schema.alterTable('character_buffs', (table) => {
    table.dropColumn('total_ms');
  });
}

/**
 * Reverse — restore `total_ms`, drop `expires_at_ms`.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('character_buffs', (table) => {
    table.integer('total_ms').unsigned().notNullable().defaultTo(0);
  });
  await db.schema.alterTable('character_buffs', (table) => {
    table.dropColumn('expires_at_ms');
  });
}
