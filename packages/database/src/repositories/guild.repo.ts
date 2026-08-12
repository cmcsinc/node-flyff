import type { Knex } from '../types';

/** One row of `guild` (migration `023`) -- a guild's own attributes. */
export interface GuildRow {
  readonly id: number;
  readonly name: string;
  readonly master_id: number;
  readonly level: number;
  readonly logo: number;
  readonly contribution_pxp: number;
  readonly gold: number;
  readonly notice: string;
  readonly power_0: number;
  readonly power_1: number;
  readonly power_2: number;
  readonly power_3: number;
  readonly power_4: number;
  readonly penya_0: number;
  readonly penya_1: number;
  readonly penya_2: number;
  readonly penya_3: number;
  readonly penya_4: number;
  readonly win: number;
  readonly lose: number;
  readonly surrender: number;
  readonly win_point: number;
  readonly created_at_ms: number;
}

/** One row of `guild_member` -- a roster entry. `member_lv` 0 is the master. */
export interface GuildMemberRow {
  readonly id: number;
  readonly guild_id: number;
  readonly character_id: number;
  readonly member_lv: number;
  readonly class: number;
  readonly pay: number;
  readonly give_gold: number;
  readonly give_pxp: number;
  readonly win: number;
  readonly lose: number;
  readonly surrender: number;
  readonly alias: string;
  readonly selected_vote_id: number;
  readonly joined_at_ms: number;
}

/** A roster entry in camelCase, as `GuildManager` holds it. */
export interface GuildMember {
  readonly characterId: number;
  /** `m_nMemberLv` -- GUD_MASTER = 0 .. GUD_ROOKIE = 4. */
  readonly memberLv: number;
  /** `m_nClass` -- sub-grade A/B/C (0..2). */
  readonly memberClass: number;
  readonly pay: number;
  readonly giveGold: number;
  readonly givePxp: number;
  readonly win: number;
  readonly lose: number;
  readonly surrender: number;
  readonly alias: string;
  readonly selectedVoteId: number;
}

/** A guild plus its roster, master first. */
export interface GuildWithMembers {
  readonly id: number;
  readonly name: string;
  readonly masterId: number;
  readonly level: number;
  readonly logo: number;
  readonly contributionPxp: number;
  readonly gold: number;
  readonly notice: string;
  /** `m_adwPower[5]` -- PF_* mask per rank. Index 0 (master) is always 0xFF. */
  readonly power: number[];
  /** `m_adwPenya[5]` -- daily salary per rank. */
  readonly penya: number[];
  readonly win: number;
  readonly lose: number;
  readonly surrender: number;
  /**
   * `m_nWinPoint` (`guild.h:288`) -- the war ladder score, added in migration
   * `025`. Deliberately absent from `CGuild::Serialize`: the client never sees
   * it, CoreServer keeps it only for the ranking query (`DbManager.cpp:519`).
   */
  readonly winPoint: number;
  /** Ordered by `member_lv` then insertion -- index 0 is the master. */
  readonly members: GuildMember[];
}

/** Mutable guild fields (everything but `id` and `created_at_ms`). */
export interface GuildUpdateData {
  name?: string;
  master_id?: number;
  level?: number;
  logo?: number;
  contribution_pxp?: number;
  gold?: number;
  notice?: string;
  power_0?: number;
  power_1?: number;
  power_2?: number;
  power_3?: number;
  power_4?: number;
  penya_0?: number;
  penya_1?: number;
  penya_2?: number;
  penya_3?: number;
  penya_4?: number;
  win?: number;
  lose?: number;
  surrender?: number;
  win_point?: number;
}

/** Mutable roster-entry fields. `class` is quoted -- JS reserved word. */
export interface GuildMemberUpdateData {
  member_lv?: number;
  class?: number;
  pay?: number;
  give_gold?: number;
  give_pxp?: number;
  win?: number;
  lose?: number;
  surrender?: number;
  alias?: string;
  selected_vote_id?: number;
}

/**
 * GuildRepository -- the `guild` + `guild_member` + `guild_cooldown` tables
 * (migration `023`).
 *
 * Ported from `CGuild` / `CGuildMember` (`_Common/guild.h`) and the CoreServer
 * row in `_Database/DbManager.cpp:2799-2860`. Unlike parties, guilds ARE
 * durable in C++ too -- CoreServer reloads them from `GUILD_TBL` at boot -- so
 * this repo is a faithful port rather than a divergence.
 *
 * Every mutation is write-through (matching the party/friend/campus repos) so a
 * hard kill cannot roll a roster back. Membership is patched per-row, not
 * wholesale like `PartyRepository.replaceMembers`: guild rank is a column
 * (`member_lv`), not a positional slot, so there is no ordering invariant that
 * a partial write could break.
 *
 * @module database/repositories/guild
 */
export class GuildRepository {
  constructor(private readonly db: Knex) {}

  /** Every guild with its roster -- the world-boot hydrate. */
  async loadAll(): Promise<GuildWithMembers[]> {
    const guilds: GuildRow[] = await this.db('guild').select('*');
    const members: GuildMemberRow[] = await this.db('guild_member')
      .orderBy([{ column: 'member_lv', order: 'asc' }, { column: 'id', order: 'asc' }])
      .select('*');
    const byGuild = new Map<number, GuildMember[]>();
    for (const m of members) {
      const list = byGuild.get(m.guild_id) ?? [];
      list.push(toMember(m));
      byGuild.set(m.guild_id, list);
    }
    return guilds.map((g) => toWithMembers(g, byGuild.get(g.id) ?? []));
  }

  /** Highest guild id in use, or 0 when there are none (id-counter seed). */
  async maxId(): Promise<number> {
    const row = await this.db('guild')
      .max({ m: 'id' })
      .first();
    return Number(row?.m ?? 0);
  }

  /** Insert a guild with its initial roster in one transaction. */
  async create(guild: GuildWithMembers, nowMs = Date.now()): Promise<void> {
    await this.db.transaction(async (trx: Knex) => {
      await trx('guild').insert({
        id: guild.id,
        name: guild.name,
        master_id: guild.masterId,
        level: guild.level,
        logo: guild.logo,
        contribution_pxp: guild.contributionPxp,
        gold: guild.gold,
        notice: guild.notice,
        power_0: guild.power[0] ?? 255,
        power_1: guild.power[1] ?? 0,
        power_2: guild.power[2] ?? 0,
        power_3: guild.power[3] ?? 0,
        power_4: guild.power[4] ?? 0,
        penya_0: guild.penya[0] ?? 0,
        penya_1: guild.penya[1] ?? 0,
        penya_2: guild.penya[2] ?? 0,
        penya_3: guild.penya[3] ?? 0,
        penya_4: guild.penya[4] ?? 0,
        win: guild.win,
        lose: guild.lose,
        surrender: guild.surrender,
        win_point: guild.winPoint,
        created_at_ms: nowMs,
      });
      if (guild.members.length > 0) {
        await trx('guild_member').insert(guild.members.map((m) => ({
          guild_id: guild.id,
          character_id: m.characterId,
          member_lv: m.memberLv,
          'class': m.memberClass,
          pay: m.pay,
          give_gold: m.giveGold,
          give_pxp: m.givePxp,
          win: m.win,
          lose: m.lose,
          surrender: m.surrender,
          alias: m.alias,
          selected_vote_id: m.selectedVoteId,
          joined_at_ms: nowMs,
        })));
      }
    });
  }

  /** Patch mutable guild fields. A no-op for an empty patch. */
  async update(guildId: number, data: GuildUpdateData): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await this.db('guild').where({ id: guildId }).update(data);
  }

  /** Add one member at the given rank. Defaults elsewhere match `CGuildMember`. */
  async addMember(
    guildId: number, characterId: number, memberLv: number, nowMs = Date.now(),
  ): Promise<void> {
    await this.db('guild_member').insert({
      guild_id: guildId,
      character_id: characterId,
      member_lv: memberLv,
      joined_at_ms: nowMs,
    });
  }

  /**
   * Drop a member. Keyed on `character_id` (not guild + character) because
   * `UNIQUE(character_id)` makes it unambiguous, and the call sites -- leave,
   * kick, character delete -- only ever know the character.
   */
  async removeMember(characterId: number): Promise<void> {
    await this.db('guild_member').where({ character_id: characterId }).delete();
  }

  /** Patch one roster entry. A no-op for an empty patch. */
  async updateMember(characterId: number, data: GuildMemberUpdateData): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await this.db('guild_member').where({ character_id: characterId }).update(data);
  }

  /** Drop the guild; `guild_member` rows cascade. */
  async remove(guildId: number): Promise<void> {
    await this.db('guild').where({ id: guildId }).delete();
  }

  // --- rejoin lockout (`CPlayer::m_tGuildMember`) ---

  /**
   * Upsert the 2-day rejoin lockout deadline. Overwrites unconditionally: a
   * later leave/kick always supersedes an earlier one.
   */
  async setCooldown(characterId: number, untilMs: number): Promise<void> {
    await this.db('guild_cooldown')
      .insert({ character_id: characterId, until_ms: untilMs })
      .onConflict('character_id')
      .merge({ until_ms: untilMs });
  }

  /** Lockout deadline in epoch ms, or 0 when the character has none. */
  async getCooldown(characterId: number): Promise<number> {
    const row = await this.db('guild_cooldown')
      .where({ character_id: characterId })
      .select('until_ms')
      .first();
    return Number(row?.until_ms ?? 0);
  }

  /** Every lockout, character id -> deadline ms -- the world-boot hydrate. */
  async loadAllCooldowns(): Promise<Map<number, number>> {
    const rows: { character_id: number; until_ms: number }[] =
      await this.db('guild_cooldown').select('*');
    return new Map(rows.map((r) => [r.character_id, Number(r.until_ms)]));
  }
}

function toMember(m: GuildMemberRow): GuildMember {
  return {
    characterId: m.character_id,
    memberLv: m.member_lv,
    memberClass: m.class,
    pay: m.pay,
    giveGold: m.give_gold,
    givePxp: m.give_pxp,
    win: m.win,
    lose: m.lose,
    surrender: m.surrender,
    alias: m.alias,
    selectedVoteId: m.selected_vote_id,
  };
}

function toWithMembers(g: GuildRow, members: GuildMember[]): GuildWithMembers {
  return {
    id: g.id,
    name: g.name,
    masterId: g.master_id,
    level: g.level,
    logo: g.logo,
    contributionPxp: g.contribution_pxp,
    gold: g.gold,
    notice: g.notice,
    power: [g.power_0, g.power_1, g.power_2, g.power_3, g.power_4],
    penya: [g.penya_0, g.penya_1, g.penya_2, g.penya_3, g.penya_4],
    win: g.win,
    lose: g.lose,
    surrender: g.surrender,
    winPoint: g.win_point,
    members,
  };
}
