import type { Knex } from '../types';

/**
 * Friend roster -- `CRTMessenger` (`_Common/rtmessenger.h:17`), the `__RT_1025`
 * variant that v19 actually compiles (`WORLDSERVER/VersionCommon.h:127`).
 *
 * C++ holds it as `map<u_long, Friend>` where
 * `Friend { BOOL bBlock; DWORD dwState; }`. Only `bBlock` persists -- `dwState`
 * is live presence (`FRS_ONLINE`/`OFFLINE`/`ABSENT`/...), recomputed from who is
 * connected, so it is deliberately NOT a column. The owner's own status
 * (`CRTMessenger::m_dwState`) does persist: C++ keeps it on the character row
 * (`m_nMessengerState`, `DbManager.cpp:672`), so it goes on `characters` here
 * rather than in this table.
 *
 * Storage: one row per DIRECTED edge, per rule 11 (a 1:N collection gets its own
 * table, never a JSON column on `characters`). Friendship is symmetric in
 * behaviour -- `OnAddFriend` inserts both directions
 * (`CORESERVER/DPCacheSrvr.cpp:2012-2016`) and `OnRemoveFriend` deletes both
 * (`:2204/2213`) -- but the edges are stored separately because `bBlock` is
 * per-direction: A can block B without B blocking A.
 *
 * `MAX_FRIEND` (200, `_Common/messenger.h:20`) is enforced in the service, not
 * as a constraint -- C++ checks it at insert time and at DB load
 * (`DbManager.cpp:7805` errors on overflow).
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('friends', (table: any) => {
    table.increments('id').primary();
    // Roster owner.
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    // The friend. FK'd + cascaded so a deleted character leaves no dangling
    // edges pointing at it (the reverse edge is dropped by the owner's cascade).
    table.integer('friend_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    // `Friend::bBlock` -- per-direction block. A blocked friend is reported to
    // the blocker's peers as FRS_OFFLINE (DPCacheSrvr.cpp:340).
    table.boolean('blocked').notNullable().defaultTo(false);
    table.bigInteger('created_at_ms').notNullable();

    table.unique(['character_id', 'friend_id']);
    table.index(['character_id']);
  });

  // `CRTMessenger::m_dwState` -- the owner's own presence status, one of the
  // FRS_* values (0..11). Persisted per C++ `m_nMessengerState`; defaults to
  // FRS_ONLINE (0).
  await db.schema.alterTable('characters', (table: any) => {
    table.integer('messenger_state').notNullable().defaultTo(0);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('messenger_state');
  });
  await db.schema.dropTableIfExists('friends');
}
