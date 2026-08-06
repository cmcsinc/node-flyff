import type { Knex } from '../types';

/**
 * Guild persistence -- `CGuild` / `CGuildMember` (`_Common/guild.h:179-376`),
 * mirroring the CoreServer DB row written by `CDbManager` (`_Database/
 * DbManager.cpp:2799-2860`).
 *
 * Three tables, per rule 11 (a 1:N collection gets its own table, never a JSON
 * column on the owner):
 *   `guild`          -- one row per guild, the guild's own attributes
 *   `guild_member`   -- the roster collection, one row per member
 *   `guild_cooldown` -- the 2-day rejoin lockout, one row per character
 *
 * The `__VER < 11` block of `CGuildMember` (`m_dwSex`, `m_nJob`, `m_nLevel`,
 * `m_nLogin`, `m_nMultiNo`) is deliberately NOT ported: from v11 on, that data
 * is read from the player record (`__SYS_PLAYER_DATA`), and `m_nLogin` is live
 * presence -- persisting it would strand members "offline" after a crash, the
 * same reason `PartyMember::m_bRemove` and `friends.dwState` have no column.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('guild', (table: any) => {
    // NOT `increments`: `GuildManager` issues the id in-memory (the roster
    // broadcast needs it before any await) and inserts it explicitly, seeding
    // its counter from `max(id) + 1` at boot -- exactly like `parties` (022).
    table.integer('id').primary();
    // `m_szGuild`. In-memory width is MAX_G_NAME = 48; the CoreServer SQL
    // column is only 16, which truncates. 48 wins -- it is what the wire and
    // the client actually carry.
    table.string('name', 48).notNullable();
    // `m_idMaster`. Deliberately NOT a foreign key: C++ derives the master from
    // whichever member holds `m_nMemberLv == GUD_MASTER`, and an FK here would
    // block deleting a character who happens to be a guild master.
    table.integer('master_id').unsigned().notNullable();
    // `m_nLevel` -- guild level, seeded 1.
    table.integer('level').notNullable().defaultTo(1);
    // `m_dwLogo` -- emblem image number. Write-once in C++ (set at creation).
    table.integer('logo').notNullable().defaultTo(0);
    // `m_dwContributionPxp` -- pooled skill-exp contribution.
    table.integer('contribution_pxp').notNullable().defaultTo(0);
    // `m_nGoldGuild` -- the guild bank penya pool.
    table.integer('gold').notNullable().defaultTo(0);
    // `m_szNotice` -- guild notice board (MAX_BYTE_NOTICE).
    table.string('notice', 128).notNullable().defaultTo('');
    // `m_adwPower[MAX_GM_LEVEL]` -- the PF_* authority mask per rank
    // (GUD_MASTER = 0 .. GUD_ROOKIE = 4). C++ hardcodes
    // `m_adwPower[GUD_MASTER] = 0x000000FF` both on create and on DB load, so
    // the master's full mask is a constant, not stored state -- the default
    // encodes that.
    table.integer('power_0').notNullable().defaultTo(255);
    table.integer('power_1').notNullable().defaultTo(0);
    table.integer('power_2').notNullable().defaultTo(0);
    table.integer('power_3').notNullable().defaultTo(0);
    table.integer('power_4').notNullable().defaultTo(0);
    // `m_adwPenya[MAX_GM_LEVEL]` -- per-rank daily salary.
    table.integer('penya_0').notNullable().defaultTo(0);
    table.integer('penya_1').notNullable().defaultTo(0);
    table.integer('penya_2').notNullable().defaultTo(0);
    table.integer('penya_3').notNullable().defaultTo(0);
    table.integer('penya_4').notNullable().defaultTo(0);
    // `m_nWin` / `m_nLose` / `m_nSurrender` -- the guild-war record.
    table.integer('win').notNullable().defaultTo(0);
    table.integer('lose').notNullable().defaultTo(0);
    table.integer('surrender').notNullable().defaultTo(0);
    table.bigInteger('created_at_ms').notNullable();
    table.unique(['name']);
  });

  await db.schema.createTable('guild_member', (table: any) => {
    table.increments('id').primary();
    table.integer('guild_id').unsigned().notNullable()
      .references('id').inTable('guild').onDelete('CASCADE');
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    // `m_nMemberLv` -- GUD_MASTER = 0 .. GUD_ROOKIE = 4. Rookie is the default
    // an invited member starts at.
    table.integer('member_lv').notNullable().defaultTo(4);
    // `m_nClass` -- sub-grade A/B/C (0..2) within the rank.
    table.integer('class').notNullable().defaultTo(0);
    // `m_nPay` -- salary flag/amount owed on the next payout.
    table.integer('pay').notNullable().defaultTo(0);
    // `m_nGiveGold` / `m_dwGivePxpCount` -- lifetime contribution totals.
    table.integer('give_gold').notNullable().defaultTo(0);
    table.integer('give_pxp').notNullable().defaultTo(0);
    // `m_nWin` / `m_nLose` / `m_nSurrender` -- per-member war record.
    table.integer('win').notNullable().defaultTo(0);
    table.integer('lose').notNullable().defaultTo(0);
    table.integer('surrender').notNullable().defaultTo(0);
    // `m_szAlias` -- guild nickname (MAX_GM_ALIAS).
    table.string('alias', 48).notNullable().defaultTo('');
    // `m_idSelectedVote` -- the vote this member has already answered.
    table.integer('selected_vote_id').notNullable().defaultTo(0);
    table.bigInteger('joined_at_ms').notNullable();
    // A character is in at most one guild (`CMover::m_idGuild` is scalar).
    table.unique(['character_id']);
    table.index(['guild_id']);
  });

  await db.schema.createTable('guild_cooldown', (table: any) => {
    // `CPlayer::m_tGuildMember` -- set to now + 2 days on leave/kick/disband
    // and checked when accepting an invite (and in `IsPartyGuild`). Its own
    // table rather than a `characters` column: it outlives membership, so it
    // cannot hang off `guild_member`, and it is guild state, not character
    // identity.
    table.integer('character_id').unsigned().primary()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.bigInteger('until_ms').notNullable();
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('guild_cooldown');
  await db.schema.dropTableIfExists('guild_member');
  await db.schema.dropTableIfExists('guild');
}
