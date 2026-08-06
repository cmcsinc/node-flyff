import type { Knex } from '../types';

/**
 * Guild-quest persistence -- `GUILDQUEST` (`_Common/guildquest.h:40-53`), the
 * per-guild quest state CoreServer keeps in `GUILD_QUEST_STR`.
 *
 * The original writes through DatabaseServer on every change:
 *   `SendInsertGuildQuest(idGuild, nId)`         `DPDatabaseClient.cpp:2348`
 *   `SendUpdateGuildQuest(idGuild, nId, nState)` `:2355`
 *   `SendQueryGuildQuest()` at boot (empty payload) `:2342`, called from
 *   `ThreadMng.cpp:248` -- and ONLY when `EVE_WORMON` is on.
 * The QUERY response (`_Database/DbManager.cpp:4247`) is `int nCount`, then per
 * guild: `u_long idGuild`, `BYTE m_nQuestSize`, then a raw blit of
 * `sizeof(GUILDQUEST) * m_nQuestSize` -- `{ int nId; int nState; u_long
 * idGuild; }`, 12 bytes, no padding.
 *
 * One row per (guild, quest). NOT a JSON column on `guild` (rule 11): a guild's
 * quests are a 1:N collection, and C++ holding them as a fixed
 * `GUILDQUEST m_aQuest[MAX_GUILD_QUEST]` (256, `guildquest.h:10`) is an array
 * layout for a raw blit, not a schema decision.
 *
 * Tombstones are NOT stored. `CGuild::RemoveQuest` (`guild.cpp:946`) sets
 * `nId = -1` in place and never shrinks `m_nQuestSize` (a `BYTE`,
 * `guild.h:348`, so it saturates one short of the 256-slot array), because a
 * flat array cannot compact without invalidating indices, and
 * `PACKETTYPE_DELETEGUILDQUEST` (0xf000b05a) is defined but never sent by
 * anything. The relational equivalent of reusing an `nId == -1` slot is a real
 * DELETE plus the UNIQUE index below -- so an absent row IS the tombstone.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('guild_quest', (table: any) => {
    table.increments('id').primary();

    // `idGuild`. FK WITH CASCADE, unlike `guild_war` (025) which deliberately
    // has none: there, a disband mid-war must be resolved by the service
    // (declare a winner, clear both `m_idEnemyGuild` back-links) and a silent
    // cascade would delete the row before that ran. A disbanded guild's quest
    // rows unwind no live state at all -- they are pure garbage -- so cascading
    // is exactly right here.
    table.integer('guild_id').unsigned().notNullable()
      .references('id').inTable('guild').onDelete('CASCADE');

    // `nId` -- the numeric `QUEST_*` id. SIGNED, matching the wire type: C++
    // writes `-1` as the in-place tombstone value, so a serialized array
    // legitimately contains negatives. We never store one (see the module note),
    // but the column must not be narrowed to unsigned.
    table.integer('quest_id').notNullable();

    // `nState` -- `QS_BEGIN` (0) .. `QS_END` (14). Default 0 mirrors the
    // `GUILDQUEST` default ctor, which zeroes `nState`.
    table.integer('state').notNullable().defaultTo(0);

    // A guild holds at most one row per quest id, and this is the upsert's
    // conflict target -- so unlike `guild_war`'s plain indexes, the constraint
    // has to be real UNIQUE, not a convention enforced in the manager.
    table.unique(['guild_id', 'quest_id'], { indexName: 'guild_quest_guild_quest_uniq' });
  });
}

/**
 * Rollback. Knex REQUIRES both `up` and `down` on every migration file --
 * `Migrator._validateMigrationStructure` throws "must both up and down" and
 * fails the whole batch, so an omitted `down` breaks migrating FORWARD, not
 * just back.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('guild_quest');
}
