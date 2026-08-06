import type { Knex } from '../types';

/** One row of `guild_quest` (migration `026`). */
export interface GuildQuestRow {
  readonly id: number;
  readonly guild_id: number;
  readonly quest_id: number;
  readonly state: number;
}

/** `GUILDQUEST` (`guildquest.h:40-53`) as the guild manager holds it. */
export interface GuildQuestEntry {
  readonly guildId: number;
  /** `nId`. */
  readonly questId: number;
  /** `nState`. */
  readonly state: number;
}

/**
 * GuildQuestRepository -- the `guild_quest` table (migration `026`).
 *
 * Ported from the `GUILD_QUEST_STR` row CoreServer reloads at boot
 * (`SendQueryGuildQuest`, `DPDatabaseClient.cpp:2342`, called from
 * `ThreadMng.cpp:248` only when `EVE_WORMON` is on) and writes through on each
 * change (`SendInsertGuildQuest` `:2348`, `SendUpdateGuildQuest` `:2355`).
 *
 * Write-through like `GuildWarRepository`: the state drives which guild-quest
 * stage a guild may enter, so losing the last transition to a hard kill would
 * let a guild redo a completed stage.
 *
 * @module database/repositories/guildQuest
 */
export class GuildQuestRepository {
  constructor(private readonly db: Knex) {}

  /**
   * Every guild's quests, grouped by guild id -- the world-boot hydrate
   * (`SendQueryGuildQuest`, ThreadMng.cpp:248).
   */
  async loadAll(): Promise<Map<number, GuildQuestEntry[]>> {
    const rows: GuildQuestRow[] = await this.db('guild_quest')
      .select('id', 'guild_id', 'quest_id', 'state');
    const out = new Map<number, GuildQuestEntry[]>();
    for (const r of rows) {
      const entry = toEntry(r);
      const list = out.get(entry.guildId);
      if (list) list.push(entry);
      else out.set(entry.guildId, [entry]);
    }
    return out;
  }

  /**
   * Insert-or-update one entry. Ports BOTH `SendInsertGuildQuest` and
   * `SendUpdateGuildQuest`: C++ picks between them on `nState == QS_BEGIN`
   * (`ScriptLib.cpp:476-479`), which is a DatabaseServer-protocol detail, not a
   * semantic one -- both land on the same `GUILD_QUEST_STR` row.
   */
  async upsert(guildId: number, questId: number, state: number): Promise<void> {
    await this.db('guild_quest')
      .insert({ guild_id: guildId, quest_id: questId, state })
      .onConflict(['guild_id', 'quest_id'])
      .merge(['state']);
  }

  /**
   * Drop one entry. NOTE: `PACKETTYPE_DELETEGUILDQUEST` (0xf000b05a) is defined
   * in the original but never sent, and `CGuild::RemoveQuest` (`guild.cpp:946`)
   * tombstones in place instead. Provided because our schema has no tombstone
   * row (a UNIQUE index plus a real delete is the relational equivalent of
   * reusing a `nId == -1` slot) -- so the caller that would tombstone deletes.
   */
  async remove(guildId: number, questId: number): Promise<void> {
    await this.db('guild_quest').where({ guild_id: guildId, quest_id: questId }).del();
  }
}

function toEntry(r: GuildQuestRow): GuildQuestEntry {
  return { guildId: r.guild_id, questId: r.quest_id, state: r.state };
}
