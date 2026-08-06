import type { Knex } from '../types';

/**
 * Guild-war persistence -- `CGuildWar` (`_Common/guildwar.h:41-66`) and the
 * `m_nWinPoint` column that migration `023` omitted.
 *
 * Two changes:
 *
 * 1. **`guild.win_point`.** `CGuild::m_nWinPoint` (`guild.h:288`) is the guild's
 *    war ladder score. `023` shipped `win`/`lose`/`surrender` but not this,
 *    because the win-point formula only runs inside `CGuildWarMng::Result`
 *    (`guildwar.cpp:199-215`) -- phase 5 territory. Note it is deliberately NOT
 *    in `CGuild::Serialize`: the client never receives it, it exists only for
 *    the CoreServer ranking query (`DbManager.cpp:519`).
 *
 * 2. **`guild_war`.** One row per live war, mirroring the `GUILD_WAR_STR` table
 *    CoreServer reloads at boot (`CDbManager::OpenGuildWar` -- the `WAR_QUERYINFO
 *    "S1"` query, which selects `m_idWar`, both guilds' `m_nCount`/`m_nSurrender`
 *    /`m_nDeath`/`m_nAbsent`, `State`, and the start time, then calls
 *    `g_GuildWarMng.AddWar`). Wars ARE durable in the original: a CoreServer
 *    restart mid-war resumes it, including the two `m_idEnemyGuild` back-links
 *    it re-derives from the loaded rows.
 *
 * The `decl_`/`acpt_` prefixes flatten the two `WAR_ENTRY` structs
 * (`guildwar.h:7-15`). Not normalized into a `guild_war_side` child table
 * because the pair is fixed at exactly two and asymmetric -- `IsDecl` decides
 * every branch in `Result`, so "which side" is a discriminator, not a row key.
 *
 * `started_at_sec` is SECONDS, not ms: it is written to the wire as a 32-bit
 * `time_t` (`_USE_32BIT_TIME_T` is set in every server `StdAfx.h`), and
 * `GetEndTime()` adds a `CTimeSpan` to it. Storing ms here would force a
 * conversion at every read and invite a unit bug at the one place that matters.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('guild', (table: any) => {
    // `m_nWinPoint`. Signed: `Result` subtracts from the loser and only then
    // clamps at zero (`guildwar.cpp:214`), so a negative intermediate is real.
    table.integer('win_point').notNullable().defaultTo(0);
  });

  await db.schema.createTable('guild_war', (table: any) => {
    // NOT `increments`: `GuildWarManager` issues the id in-memory before any
    // await (the ACPT_GUILD_WAR broadcast carries it) and inserts it
    // explicitly, seeding from `max(id) + 1` at boot -- the same pattern as
    // `guild` (023) and `parties` (022). C++ does exactly this too: `AddWar`
    // bumps `m_id` itself, and boot seeds it from `Max_m_idWar`.
    table.integer('id').primary();

    // Declaring side -- `m_Decl`. No FK to `guild`: a guild disbanding
    // mid-war is resolved by the service (which ends the war), and an FK with
    // CASCADE would silently delete the war row before that ran.
    table.integer('decl_guild_id').unsigned().notNullable();
    // `nSize` -- roster headcount SNAPSHOT at accept time, not a live count.
    // The surrender threshold divides by it (`DPCacheSrvr.cpp:2312`), so it
    // must stay frozen: recomputing it would let a guild dodge the 70% rule by
    // recruiting mid-war.
    table.integer('decl_size').notNullable().defaultTo(0);
    table.integer('decl_surrender').notNullable().defaultTo(0);
    table.integer('decl_dead').notNullable().defaultTo(0);
    // `nAbsent` -- incremented once per world tick that the guild master is
    // offline (`CGuildWar::Process` -> `SendWarMasterAbsent`), so it is a
    // duration in tick units, not an event count. See the manager for how the
    // tick period is normalized.
    table.integer('decl_absent').notNullable().defaultTo(0);

    // Accepting side -- `m_Acpt`.
    table.integer('acpt_guild_id').unsigned().notNullable();
    table.integer('acpt_size').notNullable().defaultTo(0);
    table.integer('acpt_surrender').notNullable().defaultTo(0);
    table.integer('acpt_dead').notNullable().defaultTo(0);
    table.integer('acpt_absent').notNullable().defaultTo(0);

    // `m_nFlag` -- a WF_* ASCII CHARACTER code ('0' = WF_WARTIME, '9' =
    // WF_END), stored as its numeric byte. Integer rather than a 1-char string
    // so the wire write is a plain `writeByte` with no re-encoding.
    table.integer('flag').notNullable();
    // `m_time` -- war start, UNIX SECONDS (see the module note above).
    table.integer('started_at_sec').notNullable();

    // A guild is in at most one war (`CGuild::m_idWar` is scalar), so both
    // sides are unique lookups. Enforced as indexes rather than UNIQUE
    // constraints: the invariant lives in the manager, and a UNIQUE here would
    // turn a recoverable bug into a failed insert mid-broadcast.
    table.index(['decl_guild_id'], 'guild_war_decl_idx');
    table.index(['acpt_guild_id'], 'guild_war_acpt_idx');
  });
}
