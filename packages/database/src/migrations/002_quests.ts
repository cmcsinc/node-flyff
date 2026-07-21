import type { Knex } from '../types.js';

/**
 * Per-player quest state + audit log.
 *
 * Mirrors the C++ per-mover arrays (`_Common/Mover.h:702-709`):
 *   m_aQuest[100]            → character_quests (one row per active quest)
 *   m_aCompleteQuest[300]    → character_completed_quests
 *   m_aCheckedQuest[5]       → character_checked_quests
 * Plus `quest_log` — the `CalluspLoggingQuest` audit trail (actions 10/20/30).
 *
 * The wire QUEST struct fields map to columns directly; `flags` packs the
 * `m_bPatrol`/`m_bDialog` bitfield (see `core/constants/quest.ts` QUEST_FLAG).
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('character_quests', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('quest_id').unsigned().notNullable();
    table.integer('state').unsigned().defaultTo(0);       // QS_* (m_nState)
    table.integer('time').unsigned().defaultTo(0);        // m_wTime
    table.integer('kill_npc_num_0').unsigned().defaultTo(0);
    table.integer('kill_npc_num_1').unsigned().defaultTo(0);
    table.integer('flags').unsigned().defaultTo(0);       // QUEST_FLAG bitfield
    table.timestamps(true, true);
    table.unique(['character_id', 'quest_id']);
  });

  await db.schema.createTable('character_completed_quests', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('quest_id').unsigned().notNullable();
    table.timestamp('completed_at').defaultTo(db['fn'].now());
    table.unique(['character_id', 'quest_id']);
  });

  await db.schema.createTable('character_checked_quests', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('quest_id').unsigned().notNullable();
    table.integer('slot').unsigned().notNullable();        // 0–4 (MAX_CHECKED_QUEST)
    table.unique(['character_id', 'slot']);
    table.unique(['character_id', 'quest_id']);
  });

  await db.schema.createTable('quest_log', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE').index();
    table.integer('quest_id').unsigned().notNullable();
    table.integer('action').unsigned().notNullable();      // QUEST_LOG_ACTION (10/20/30)
    table.timestamp('ts').defaultTo(db['fn'].now());
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('quest_log');
  await db.schema.dropTableIfExists('character_checked_quests');
  await db.schema.dropTableIfExists('character_completed_quests');
  await db.schema.dropTableIfExists('character_quests');
}
