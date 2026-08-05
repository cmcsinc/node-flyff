import type { Knex } from '../types';

/**
 * Party persistence -- `CParty` / `CPartyMng` (`_Common/party.cpp`).
 *
 * **Deliberate divergence from C++.** Vanilla keeps the whole roster in
 * CoreServer RAM and persists only `characters.m_idparty`; a CoreServer restart
 * therefore destroys every party (`CPartyMng::CPartyMng` resets `m_id = 0`, and
 * `AddConnection` zeroes any `m_uPartyId` that no longer resolves --
 * `party.cpp:844`, `:1184`). It also reaps a member who has been offline for
 * 10 minutes (`CPartyMng::Worker`, `party.cpp:1121`) and destroys a party whose
 * every member is offline (`RemoveConnection`, `:1259`).
 *
 * Here the roster is durable: logging out marks a member offline (never removes
 * them), an all-offline party survives, and the roster reloads at world boot.
 * The 600 s reaper is intentionally NOT ported. Removal happens only on an
 * explicit leave/kick that drops the roster below 2.
 *
 * Two tables, per rule 11 (a 1:N collection gets its own table, never a JSON
 * column on the owner):
 *   `parties`      -- one row per party, holding the party's own attributes
 *   `party_member` -- the membership collection, one row per member
 *
 * `slot` mirrors `CParty::m_aMember`'s index; **slot 0 is always the leader**
 * (C++ keeps it there via `SwapPartyMember(0, idx)`), so the roster order is
 * part of the persisted state, not a rendering detail.
 *
 * `PartyMember::m_bRemove` (the offline flag) is deliberately NOT a column: it
 * is live presence, derived from whether the character is in `PlayerManager` --
 * the same reason `friends.dwState` is not persisted (migration `019`). A
 * persisted flag would strand members "offline" after a crash.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('parties', (table: any) => {
    // NOT `increments`: `PartyManager` issues the id in-memory (the roster
    // broadcast needs it before any await) and inserts it explicitly, seeding
    // its counter from `max(id) + 1` at boot.
    table.integer('id').primary();
    // `m_nKindTroup` -- 0 solo, 1 troupe ("advance party"). One-way in C++.
    table.integer('kind_troup').notNullable().defaultTo(0);
    // `m_sParty` -- troupe name; empty while `kind_troup = 0`.
    table.string('name', 32).notNullable().defaultTo('');
    // `m_nLevel` / `m_nExp` / `m_nPoint` -- the party level bar. C++ seeds
    // level 1 (`party.cpp:55`).
    table.integer('level').notNullable().defaultTo(1);
    table.integer('exp').notNullable().defaultTo(0);
    table.integer('point').notNullable().defaultTo(0);
    // `m_nTroupsShareExp` (0 level split) / `m_nTroupeShareItem` (0 finder,
    // 1 sequential, 2 leader, 3 random).
    table.integer('exp_mode').notNullable().defaultTo(0);
    table.integer('item_mode').notNullable().defaultTo(0);
    // `m_nGetItemPlayerId` -- sequential-mode cursor. A member **id**, not an
    // index, so members walking in and out of range cannot desync it.
    table.integer('last_item_getter_id').notNullable().defaultTo(0);
    table.bigInteger('created_at_ms').notNullable();
  });

  await db.schema.createTable('party_member', (table: any) => {
    table.increments('id').primary();
    table.integer('party_id').unsigned().notNullable()
      .references('id').inTable('parties').onDelete('CASCADE');
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    // `m_aMember` index. 0 = leader.
    table.integer('slot').notNullable();
    table.bigInteger('joined_at_ms').notNullable();
    // A character is in at most one party (`CMover::m_idparty` is scalar).
    table.unique(['character_id']);
    table.index(['party_id']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('party_member');
  await db.schema.dropTableIfExists('parties');
}
