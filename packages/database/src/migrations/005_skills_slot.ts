import type { Knex } from '../types';

/**
 * Skill slot axis on `skills` + `skill_point` / `skill_level` on `characters`.
 *
 * v15 character skill state is a flat 45-slot array (`m_aJobSkill[45]` -- see
 * `_Common/Mover.h`, docs #5). Each slot is either a learned `{ skillId, level }`
 * pair or empty (sentinel `0xffffffff`). The original `skills.unique` was
 * `(character_id, skill_id)` -- but the same skill id cannot legitimately occupy
 * two slots, so a `(character_id, slot)` unique better matches the client's
 * array layout and lets `saveAll` delete + re-insert without per-skill upserts.
 *
 * `skill_point` (C++ `m_nSkillPoint` -- unspent SP) and `skill_level` (C++
 * `m_nSkillLevel` -- total SP earned) live on the character row, hydrated into
 * `CPlayer` on JOIN and persisted through dirty-flag flush.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('skills', (table: any) => {
    table.integer('slot').unsigned().notNullable().defaultTo(0);
  });
  await db.schema.alterTable('skills', (table: any) => {
    table.dropUnique(['character_id', 'skill_id']);
  });
  await db.schema.alterTable('skills', (table: any) => {
    table.unique(['character_id', 'slot']);
  });
  await db.schema.alterTable('characters', (table: any) => {
    table.integer('skill_point').unsigned().notNullable().defaultTo(0);
    table.integer('skill_level').unsigned().notNullable().defaultTo(0);
  });
}

/**
 * Reverse -- drop `slot`, restore the original unique, drop character columns.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('skills', (table: any) => {
    table.dropUnique(['character_id', 'slot']);
  });
  await db.schema.alterTable('skills', (table: any) => {
    table.unique(['character_id', 'skill_id']);
    table.dropColumn('slot');
  });
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('skill_point');
    table.dropColumn('skill_level');
  });
}
