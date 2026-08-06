import type { Knex } from '../types';

/** One row of `guild_war` (migration `025`) -- a live war. */
export interface GuildWarRow {
  readonly id: number;
  readonly decl_guild_id: number;
  readonly decl_size: number;
  readonly decl_surrender: number;
  readonly decl_dead: number;
  readonly decl_absent: number;
  readonly acpt_guild_id: number;
  readonly acpt_size: number;
  readonly acpt_surrender: number;
  readonly acpt_dead: number;
  readonly acpt_absent: number;
  readonly flag: number;
  readonly started_at_sec: number;
}

/** One side of a war -- the flattened `WAR_ENTRY` (`guildwar.h:7-15`). */
export interface GuildWarSide {
  readonly guildId: number;
  /** `nSize` -- roster headcount FROZEN at accept time (the 70% divisor). */
  readonly size: number;
  readonly surrender: number;
  readonly dead: number;
  /** `nAbsent` -- master-offline duration in tick units, not an event count. */
  readonly absent: number;
}

/** A war in camelCase, as `GuildWarManager` holds it. */
export interface GuildWar {
  readonly id: number;
  readonly decl: GuildWarSide;
  readonly acpt: GuildWarSide;
  /** `m_nFlag` -- a WF_* ASCII character code as its numeric byte. */
  readonly flag: number;
  /** `m_time` -- war start in UNIX SECONDS (32-bit `time_t` on the wire). */
  readonly startedAtSec: number;
}

/** Mutable war fields -- the tick counters and the flag. */
export interface GuildWarUpdateData {
  decl_surrender?: number;
  decl_dead?: number;
  decl_absent?: number;
  acpt_surrender?: number;
  acpt_dead?: number;
  acpt_absent?: number;
  flag?: number;
}

/**
 * GuildWarRepository -- the `guild_war` table (migration `025`).
 *
 * Ported from the `GUILD_WAR_STR` row CoreServer reloads at boot
 * (`CDbManager::OpenGuildWar`, the `WAR_QUERYINFO "S1"` query) and writes
 * through on each event (`AcptWar` = `"A1"`, `SendSurrender`, `SendWarDead`,
 * `SendWarMasterAbsent`, `WarEnd`). Wars are durable in the original: a restart
 * mid-war resumes it, and the boot path re-derives both guilds'
 * `m_idEnemyGuild` back-links from the loaded rows.
 *
 * Write-through like `GuildRepository`, and for the same reason: the counters
 * feed a termination decision (`OnWarTimeout` compares `nAbsent` then `nDead`),
 * so losing the last few increments to a hard kill would change who won.
 *
 * @module database/repositories/guildWar
 */
export class GuildWarRepository {
  constructor(private readonly db: Knex) {}

  /** Every live war -- the world-boot hydrate. */
  async loadAll(): Promise<GuildWar[]> {
    const rows: GuildWarRow[] = await this.db('guild_war').select('*');
    return rows.map(toWar);
  }

  /** Highest war id in use, or 0 when there are none (id-counter seed). */
  async maxId(): Promise<number> {
    const row: { m: number | null } | undefined = await this.db('guild_war')
      .max({ m: 'id' })
      .first();
    return Number(row?.m ?? 0);
  }

  /** Insert a war. The id is issued in-memory before this runs. */
  async create(war: GuildWar): Promise<void> {
    await this.db('guild_war').insert({
      id: war.id,
      decl_guild_id: war.decl.guildId,
      decl_size: war.decl.size,
      decl_surrender: war.decl.surrender,
      decl_dead: war.decl.dead,
      decl_absent: war.decl.absent,
      acpt_guild_id: war.acpt.guildId,
      acpt_size: war.acpt.size,
      acpt_surrender: war.acpt.surrender,
      acpt_dead: war.acpt.dead,
      acpt_absent: war.acpt.absent,
      flag: war.flag,
      started_at_sec: war.startedAtSec,
    });
  }

  /** Patch the counters / flag of one war. No-op on an empty patch. */
  async update(warId: number, data: GuildWarUpdateData): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await this.db('guild_war').where({ id: warId }).update(data);
  }

  /**
   * Delete a war -- the tail of `CGuildWarMng::Result` (`guildwar.cpp:329`).
   * The original also writes a war-log row via `g_dpDatabaseClient.SendWarEnd`
   * before removing the live one; that history table is not ported (nothing
   * reads it -- the client's war record comes from `guild.win`/`lose`).
   */
  async remove(warId: number): Promise<void> {
    await this.db('guild_war').where({ id: warId }).del();
  }
}

function toSide(
  guildId: number, size: number, surrender: number, dead: number, absent: number,
): GuildWarSide {
  return { guildId, size, surrender, dead, absent };
}

function toWar(r: GuildWarRow): GuildWar {
  return {
    id: r.id,
    decl: toSide(r.decl_guild_id, r.decl_size, r.decl_surrender, r.decl_dead, r.decl_absent),
    acpt: toSide(r.acpt_guild_id, r.acpt_size, r.acpt_surrender, r.acpt_dead, r.acpt_absent),
    flag: r.flag,
    startedAtSec: r.started_at_sec,
  };
}
