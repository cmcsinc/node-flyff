import type { Knex } from '../types';

/**
 * Campus (master/pupil mentoring) -- `CCampus` / `CCampusMember`
 * (`_Common/Campus.h`). Active at v19: the `__CAMPUS` define is commented out
 * but every guard is `#if __VER >= 15`, and `__VER` is 19.
 *
 * C++ keeps campuses in the DB server and pushes the whole set to each world at
 * boot (`PACKETTYPE_CAMPUS_ALL` -> `CCampusMng::Serialize`). Membership mutation
 * is a round-trip: the world NEVER mutates a campus locally, it asks the DB
 * server (`SendAddCampusMember` / `SendRemoveCampusMember` /
 * `SendUpdateCampusPoint`) and applies the broadcast that comes back. Collapsing
 * the tiers means the service writes here directly, but the shape mirrors C++.
 *
 * Two tables, per rule 11:
 *   `campus`        -- one row per campus, holding its own attribute (the master)
 *   `campus_member` -- the 1:N membership collection, one row per member
 *
 * `characters.campus_point` is the per-character currency
 * (`CMover::m_nCampusPoint`, `_Common/Mover.h:941`) -- it belongs to the
 * character, not to any campus, and survives leaving one. It can go NEGATIVE:
 * dissolving a pairing charges `REMOVE_CAMPUS_POINT` (5) and
 * `RecoveryCampusPoint` only regenerates while the balance is below zero.
 *
 * `characters.campus_tick_ms` is `CMover::m_dwTickCampus`, the recovery cursor.
 * C++ uses `NULL_ID` as "not started"; 0 serves the same purpose here.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('campus', (table) => {
    table.increments('id').primary();
    // `CCampus::m_idMaster`. Not FK-cascaded to `characters`: C++ dissolves the
    // whole campus when the master leaves (`OnRemoveCampusMember`), which the
    // service does explicitly -- a silent cascade would orphan the pupils' rows
    // without sending them CAMPUS_REMOVE.
    table.integer('master_id').unsigned().notNullable();
    table.bigInteger('created_at_ms').notNullable();
    table.index(['master_id']);
  });

  await db.schema.createTable('campus_member', (table) => {
    table.increments('id').primary();
    table.integer('campus_id').unsigned().notNullable()
      .references('id').inTable('campus').onDelete('CASCADE');
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    // `CCampusMember::m_nMemberLv` -- CAMPUS_MASTER(1) or CAMPUS_PUPIL(2).
    table.integer('member_level').notNullable();
    table.bigInteger('joined_at_ms').notNullable();

    // A character can only be in one campus (`m_mapPid2Cid` is 1:1 in C++).
    table.unique(['character_id']);
    table.index(['campus_id']);
  });

  await db.schema.alterTable('characters', (table) => {
    // Signed on purpose -- see the module doc.
    table.integer('campus_point').notNullable().defaultTo(0);
    table.bigInteger('campus_tick_ms').notNullable().defaultTo(0);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table) => {
    table.dropColumn('campus_tick_ms');
    table.dropColumn('campus_point');
  });
  await db.schema.dropTableIfExists('campus_member');
  await db.schema.dropTableIfExists('campus');
}
