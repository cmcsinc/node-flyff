import type { Knex } from '../types';

/**
 * Normalize buffs: replace the `characters.buffs` JSON column with a dedicated
 * `character_buffs` table (one row per active buff).
 *
 * Per rule `11-database-normalization.md`, a collection that has its own
 * identity and is owned by an entity belongs in a separate table — not jammed
 * into a JSON column on the owner row. Buffs are a 1:N collection on
 * characters: each buff has a distinct `skill_id` + `type`, they come and go
 * independently, and the future "share-a-bank" pattern (an independent
 * container that can be detached from its owner) does not apply — but querying
 * individual buffs by character, counting them, or joining them to skill data
 * is much cleaner with rows than with `JSON_EACH`.
 *
 * C++ persists the active skill-buff list as a packed string
 * (`SaveSkillInfluence` / `GetSKillInfluence`), but that is a serialization
 * detail of the flat-file DB — the in-memory model (`CBuffMgr`) is a proper
 * collection of `IBuff` objects, one per active buff. The relational table
 * mirrors the in-memory model.
 *
 * Columns mirror the 4-int shape C++ saves: `{ type, id, level, total }`.
 * `total_ms` is the originally-applied TOTAL duration (not remaining) — the
 * timer resets to full on relog, matching C++ `SaveSkillInfluence`.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('character_buffs', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('type').unsigned().notNullable();          // BUFF_SKILL=1, BUFF_ITEM=0
    table.integer('skill_id').unsigned().notNullable();      // wID (skill or item id)
    table.integer('level').unsigned().notNullable();         // dwLevel
    table.integer('total_ms').unsigned().notNullable();      // GetTotal duration
    table.unique(['character_id', 'type', 'skill_id']);      // one active buff per (char, type, skill)
  });

  // Drop the legacy JSON column — all persistence now goes through the table.
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('buffs');
  });
}

/**
 * Reverse — re-add the JSON column and drop the table.
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('character_buffs');
  await db.schema.alterTable('characters', (table: any) => {
    table.text('buffs').nullable().defaultTo(null);
  });
}
