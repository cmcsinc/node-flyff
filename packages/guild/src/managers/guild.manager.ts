/**
 * GuildManager -- registry of live guilds, pending invites, and the 2-day
 * rejoin cooldown, backed by the `guild` / `guild_member` / `guild_cooldown`
 * tables (migration `023`).
 *
 * Mirrors `CGuildMng` (`_Common/guild.cpp:780-1137`): incrementing guild ids, a
 * {@link Guild} per active id, plus a name index so the duplicate-name check
 * (`CGuildMng::GetGuild(const char*)`, `guild.cpp:793`) stays O(1).
 *
 * **Persistence matches C++ here** -- unlike parties. Vanilla CoreServer loads
 * every guild from `GUILD_TBL` at boot (`CDbManager::OpenGuild`,
 * `DbManager.cpp:2799`) and writes through on each mutation, so guilds survive a
 * restart in the original too. {@link hydrate} is the port of that load.
 *
 * Offline members STAY on the roster (`m_mapPMember` is never pruned by a
 * logout -- `RemoveConnection`, `guild.cpp:882`, only fans out login notices),
 * so unlike `PartyManager` there is no "drop below N members" floor: a guild
 * whose every member is offline is still a guild. Removal happens only on an
 * explicit leave/kick, or when the master disbands.
 *
 * ponytail: guild bank, votes, guild war, guild quests, the 21:00 salary tick
 * (`CGuildMng::Process`) -- each is its own phase.
 *
 * @module managers/guild
 */

import { GUD_MASTER, GUD_ROOKIE, MAX_GM_LEVEL, GUILD_MASTER_POWER } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';
import {
  guildMaxMembers, guildMaxRankMembers, GUILD_REJOIN_COOLDOWN_MS,
  GUILD_TABLE, MAX_GUILD_LEVEL, MAX_DWORD, MAX_INT32,
  CONTRIBUTION_OK, CONTRIBUTION_FAIL_MAXLEVEL,
  CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP, CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA,
  CONTRIBUTION_FAIL_INVALID_CONDITION,
  CONTRIBUTION_FAIL_OVERFLOW_PXP, CONTRIBUTION_FAIL_OVERFLOW_PENYA,
  type ContributionResult,
} from '../guildTable';

const logger = createLogger({ module: 'guild-manager' });

/** One roster entry -- the live mirror of a `guild_member` row. */
export interface GuildMemberState {
  readonly characterId: number;
  /** `m_nMemberLv` -- GUD_MASTER(0) .. GUD_ROOKIE(4). */
  memberLv: number;
  /** `m_nClass` -- sub-grade A/B/C (0..2). Reset to 0 on any rank change. */
  memberClass: number;
  /** `m_nPay` -- salary received to date. */
  pay: number;
  /** `m_nGiveGold` -- penya contributed. */
  giveGold: number;
  /** `m_dwGivePxpCount` -- PXP contributed. */
  givePxp: number;
  win: number;
  lose: number;
  surrender: number;
  /** `m_szAlias` -- guild nickname; empty until set. */
  alias: string;
  /** `m_idSelectedVote`. */
  selectedVoteId: number;
}

/** One live guild -- the mirror of a `guild` row plus its roster. */
export interface Guild {
  readonly id: number;
  name: string;
  /**
   * `m_idMaster`. C++ derives this from whichever member has
   * `m_nMemberLv == GUD_MASTER` (`DbManager.cpp:2898`); stored explicitly here
   * so a corrupted double-master state is detectable rather than resolving to
   * map-iteration order.
   */
  masterId: number;
  level: number;
  /** `m_dwLogo` -- 0 = unset. Write-once (`CGuild::SetLogo`, `guild.cpp:516`). */
  logo: number;
  /** `m_dwContributionPxp` -- guild PXP pool; consumed by each level-up. */
  contributionPxp: number;
  /** `m_nGoldGuild` -- guild bank penya pool; also consumed by level-up. */
  gold: number;
  notice: string;
  /** `m_adwPower[5]` -- PF_* mask per rank. Index 0 is always {@link GUILD_MASTER_POWER}. */
  power: number[];
  /** `m_adwPenya[5]` -- daily salary per rank. */
  penya: number[];
  win: number;
  lose: number;
  surrender: number;
  /**
   * `m_nWinPoint` (`guild.h:288`) -- the war ladder score. NOT in
   * `CGuild::Serialize`, so no client ever sees it; it exists for the CoreServer
   * ranking query (`DbManager.cpp:519`) and as the input to the next war's
   * win-point formula (`guildwar.cpp:199`). Column added in migration `025`.
   */
  winPoint: number;
  /**
   * `m_idWar` (`guild.h:338`) -- id of the war this guild is in, 0 when none.
   * An INDEX into `GuildWarManager`, not a boolean: `CGuild::GetWar()` is a
   * registry lookup (`guild.cpp:678-682`), so a stale id whose war is gone
   * reads as "not at war" rather than faulting. In-memory only -- C++ does not
   * persist it on the guild row either, it re-derives this and
   * {@link Guild.idEnemyGuild} from the war rows at boot.
   */
  idWar: number;
  /**
   * `m_idEnemyGuild` (`guild.h:287`) -- the opposing guild id, 0 when not at
   * war. Unlike {@link Guild.idWar} this one IS on the wire
   * (`CGuild::Serialize`, `guild.cpp:425`), so the snapshot must read it.
   */
  idEnemyGuild: number;
  /**
   * `m_bSendPay` -- the once-per-day salary latch. Set when the 21:00 sweep pays
   * this guild, cleared at hour 22. In-memory only: C++ does not persist it
   * either (`CGuild::CGuild` seeds FALSE), so a restart mid-evening can pay
   * twice -- faithful, and the alternative would be inventing a column.
   */
  sentPay: boolean;
  /** Roster. Order is not load-bearing (rank lives in `memberLv`). */
  members: GuildMemberState[];
  /**
   * `m_aQuest[m_nQuestSize]` (`guild.h:347-348`) -- the guild's quest ledger,
   * which IS on the wire (tail of `CGuild::Serialize`, `guild.cpp:433`).
   *
   * Order IS load-bearing, unlike {@link Guild.members}: the client blits the
   * array and `CGuild::SetQuest` appends, so an entry's index is stable for the
   * life of the guild. We never store the `nId == -1` tombstones C++ writes in
   * place of a removed entry -- see {@link GuildManager.removeQuest}.
   */
  quests: GuildQuestState[];
}

/**
 * One `GUILDQUEST` (`_Common/guildquest.h:40-53`) -- 12 bytes on the wire.
 *
 * `idGuild` is deliberately absent: the C++ struct carries it, but
 * `CGuild::SetQuest` (`guild.cpp:909-944`) never assigns it, so every entry the
 * original serializes has `idGuild == 0` from the default ctor. The serializer
 * writes the literal 0 rather than storing a field nothing sets.
 */
export interface GuildQuestState {
  /** `nId` -- the `QUEST_*` numeric id. */
  readonly questId: number;
  /** `nState` -- `QS_BEGIN`(0) .. `QS_END`(14). */
  state: number;
}

/** One pending inbound guild invite, keyed by the TARGET character. */
export interface PendingGuildInvite {
  readonly guildId: number;
  readonly inviterId: number;
  readonly targetId: number;
  readonly expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Persistence port -- structurally satisfied by `GuildRepository`
 * (`@flyff/database`). An interface rather than the concrete class so the
 * manager stays testable with a plain object and carries no Knex knowledge.
 */
export interface GuildPersistence {
  loadAll(): Promise<{
    id: number; name: string; masterId: number; level: number; logo: number;
    contributionPxp: number; gold: number; notice: string;
    power: number[]; penya: number[]; win: number; lose: number; surrender: number;
    winPoint: number;
    members: {
      characterId: number; memberLv: number; memberClass: number; pay: number;
      giveGold: number; givePxp: number; win: number; lose: number;
      surrender: number; alias: string; selectedVoteId: number;
    }[];
  }[]>;
  maxId(): Promise<number>;
  create(guild: {
    id: number; name: string; masterId: number; level: number; logo: number;
    contributionPxp: number; gold: number; notice: string;
    power: number[]; penya: number[]; win: number; lose: number; surrender: number;
    winPoint: number;
    members: {
      characterId: number; memberLv: number; memberClass: number; pay: number;
      giveGold: number; givePxp: number; win: number; lose: number;
      surrender: number; alias: string; selectedVoteId: number;
    }[];
  }): Promise<void>;
  update(guildId: number, data: Record<string, number | string>): Promise<void>;
  addMember(guildId: number, characterId: number, memberLv: number): Promise<void>;
  removeMember(characterId: number): Promise<void>;
  updateMember(characterId: number, data: Record<string, number | string>): Promise<void>;
  remove(guildId: number): Promise<void>;
  setCooldown(characterId: number, untilMs: number): Promise<void>;
  loadAllCooldowns(): Promise<Map<number, number>>;
}

/**
 * Quest-ledger persistence port -- structurally satisfied by
 * `GuildQuestRepository` (`@flyff/database`, migration `026`).
 *
 * Separate from {@link GuildPersistence} because the original keeps them apart
 * too: guild rows come from CoreServer (`CDbManager::OpenGuild`), quest rows
 * from the DatabaseServer's `GUILD_QUEST_STR` table via a distinct
 * `SendQueryGuildQuest` round trip (`ThreadMng.cpp:248`) that only runs when
 * `EVE_WORMON` is on. Keeping the ports separate means a world with the flag
 * off never touches the table.
 */
export interface GuildQuestPersistence {
  /** guildId -> its entries. */
  loadAll(): Promise<Map<number, { guildId: number; questId: number; state: number }[]>>;
  upsert(guildId: number, questId: number, state: number): Promise<void>;
  remove(guildId: number, questId: number): Promise<void>;
}

export class GuildManager {
  private readonly guilds = new Map<number, Guild>();
  /** Lower-cased name -> guild id. Mirrors `CGuildMng::m_mapPGuild2`. */
  private readonly byName = new Map<string, number>();
  private readonly pending = new Map<number, PendingGuildInvite>();
  /** characterId -> epoch ms until which they may not join a guild. */
  private readonly cooldowns = new Map<number, number>();
  private nextId = 1;

  /**
   * Optional persistence port. Absent (tests, or a world with no DB) = pure
   * in-memory. Every write is fire-and-forget: a DB failure must never break a
   * live roster broadcast, so each call swallows its rejection into a log line.
   */
  constructor(private readonly repo?: GuildPersistence, private readonly now: () => number = Date.now) {}

  /**
   * Attach the quest-ledger port after construction.
   *
   * Late-bound rather than a constructor arg because `GuildManager` is composed
   * before the world knows whether the guild-quest flag is on, and every
   * existing test constructs it with one argument. Absent = quests live only in
   * memory.
   */
  setQuestRepo(repo: GuildQuestPersistence): void { this.questRepo = repo; }

  private questRepo?: GuildQuestPersistence;

  /**
   * Load every guild's quest ledger -- `SendQueryGuildQuest` (`ThreadMng.cpp:248`).
   *
   * Called AFTER {@link hydrate}, because it indexes into guilds that must
   * already exist. Entries for an unknown guild are dropped with a warn, which
   * is what the C++ consumer does too (`DPDatabaseClient.cpp:2362` reads them
   * into a throwaway `CGuild waste` purely to keep the stream aligned).
   */
  async hydrateQuests(): Promise<void> {
    if (!this.questRepo) return;
    const byGuild = await this.questRepo.loadAll();
    let loaded = 0;
    let orphans = 0;
    for (const [guildId, entries] of byGuild) {
      const guild = this.guilds.get(guildId);
      if (!guild) { orphans += entries.length; continue; }
      guild.quests = entries.map((e) => ({ questId: e.questId, state: e.state }));
      loaded += guild.quests.length;
    }
    if (orphans > 0) logger.warn({ orphans }, 'guild quest rows for unknown guilds');
    logger.info({ loaded }, 'guild quests loaded');
  }

  /**
   * World-boot hydrate -- the port of `CDbManager::OpenGuild` +
   * `CGuildMng::Serialize` load. Reloads every guild, its roster, and every
   * live rejoin cooldown, then seeds the id counter past the highest stored id.
   */
  async hydrate(): Promise<void> {
    if (!this.repo) return;
    const rows = await this.repo.loadAll();
    for (const r of rows) {
      const guild: Guild = {
        id: r.id, name: r.name, masterId: r.masterId, level: r.level,
        logo: r.logo, contributionPxp: r.contributionPxp, gold: r.gold,
        notice: r.notice, power: [...r.power], penya: [...r.penya],
        win: r.win, lose: r.lose, surrender: r.surrender,
        winPoint: r.winPoint,
        // C++ does not persist these on the guild row -- the war-load loop
        // re-derives both (`DbManager.cpp`, the "S1" query tail). The caller
        // does that after both managers have hydrated.
        idWar: 0, idEnemyGuild: 0,
        sentPay: false,
        members: r.members.map((m) => ({ ...m })),
        quests: [],
      };
      // C++ re-forces the master mask on every load (DbManager.cpp:2837) -- it
      // is never persisted, so a hand-edited DB cannot lock a master out.
      guild.power[GUD_MASTER] = GUILD_MASTER_POWER;
      this.guilds.set(guild.id, guild);
      this.byName.set(guild.name.toLowerCase(), guild.id);
    }
    const cds = await this.repo.loadAllCooldowns();
    const nowMs = this.now();
    for (const [charId, until] of cds) {
      if (until > nowMs) this.cooldowns.set(charId, until);
    }
    this.nextId = (await this.repo.maxId()) + 1;
    logger.info({ guilds: this.guilds.size, cooldowns: this.cooldowns.size, nextId: this.nextId }, 'guilds loaded');
  }

  get(guildId: number): Guild | undefined { return this.guilds.get(guildId); }

  /** All live guilds -- the ALL_GUILDS descriptor fan-out. */
  all(): Guild[] { return [...this.guilds.values()]; }

  /** The id counter -- `CGuildMng::m_id`, written as the ALL_GUILDS header. */
  get idCounter(): number { return this.nextId; }

  /** Case-insensitive name lookup -- the duplicate-name guard. */
  getByName(name: string): Guild | undefined {
    const id = this.byName.get(name.trim().toLowerCase());
    return id === undefined ? undefined : this.guilds.get(id);
  }

  /** The guild a character belongs to (linear scan -- guild counts are small). */
  getByMember(characterId: number): Guild | undefined {
    for (const g of this.guilds.values()) {
      if (g.members.some((m) => m.characterId === characterId)) return g;
    }
    return undefined;
  }

  /** A roster entry, or undefined when not a member. */
  getMember(guildId: number, characterId: number): GuildMemberState | undefined {
    return this.guilds.get(guildId)?.members.find((m) => m.characterId === characterId);
  }

  /** `CGuild::IsMaster`. */
  isMaster(guildId: number, characterId: number): boolean {
    return this.guilds.get(guildId)?.masterId === characterId;
  }

  /**
   * `CGuild::IsCmdCap( nMemberLv, dwPower )` (`guild.h:330`) -- does the rank
   * hold this PF_* bit? Note it takes a RANK, not a character: the caller
   * resolves the member first, exactly as every C++ call site does.
   */
  rankHasPower(guildId: number, rank: number, power: number): boolean {
    const g = this.guilds.get(guildId);
    if (!g) return false;
    return ((g.power[rank] ?? 0) & power) !== 0;
  }

  /** `CGuild::GetMemberLvSize` -- how many members currently hold `rank`. */
  rankCount(guildId: number, rank: number): number {
    const g = this.guilds.get(guildId);
    if (!g) return 0;
    let n = 0;
    for (const m of g.members) if (m.memberLv === rank) n++;
    return n;
  }

  /** `CGuild::GetMaxMemberSize()` for a live guild. */
  maxMembers(guildId: number): number {
    const g = this.guilds.get(guildId);
    return g ? guildMaxMembers(g.level) : 0;
  }

  /** `CGuild::GetMaxMemberLvSize( nMemberLv )` for a live guild. */
  maxRankMembers(guildId: number, rank: number): number {
    const g = this.guilds.get(guildId);
    return g ? guildMaxRankMembers(rank, g.level) : 0;
  }

  /**
   * Create a guild with `masterId` at GUD_MASTER and everyone in `memberIds`
   * (the rest of the founding party) at GUD_ROOKIE -- `CDPCoreSrvr::OnCreateGuild`
   * (`DPCoreSrvr.cpp:1382-1435`).
   *
   * Returns undefined when the name is already taken (the C++
   * `TID_GAME_COMOVERLAPNAME` branch at `:1375`).
   */
  create(name: string, masterId: number, memberIds: readonly number[] = []): Guild | undefined {
    const trimmed = name.trim();
    if (this.getByName(trimmed)) return undefined;
    const power = new Array<number>(MAX_GM_LEVEL).fill(0);
    power[GUD_MASTER] = GUILD_MASTER_POWER;
    const guild: Guild = {
      id: this.nextId++,
      name: trimmed,
      masterId,
      level: 1,
      logo: 0,
      contributionPxp: 0,
      gold: 0,
      notice: '',
      power,
      penya: new Array<number>(MAX_GM_LEVEL).fill(0),
      win: 0, lose: 0, surrender: 0,
      winPoint: 0,
      idWar: 0, idEnemyGuild: 0,
      sentPay: false,
      members: [newMember(masterId, GUD_MASTER)],
      quests: [],
    };
    for (const id of memberIds) {
      if (id === masterId) continue;
      guild.members.push(newMember(id, GUD_ROOKIE));
    }
    this.guilds.set(guild.id, guild);
    this.byName.set(guild.name.toLowerCase(), guild.id);
    this.persistCreate(guild);
    return guild;
  }

  /**
   * Add a member at GUD_ROOKIE -- the accept-invite path
   * (`OnAddGuildMember`, `DPCacheSrvr.cpp:1320`). Returns undefined when the
   * guild is unknown, full, or they are already in it.
   */
  addMember(guildId: number, characterId: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    if (g.members.length >= guildMaxMembers(g.level)) return undefined;
    if (g.members.some((m) => m.characterId === characterId)) return undefined;
    g.members.push(newMember(characterId, GUD_ROOKIE));
    void this.repo?.addMember(guildId, characterId, GUD_ROOKIE).catch((err: unknown) => {
      logger.error({ err, guildId, characterId }, 'guild member add persist failed');
    });
    return g;
  }

  /**
   * Remove a member and stamp their 2-day rejoin cooldown. Unlike a party this
   * never disbands the guild: C++ refuses to remove the master at all
   * (`OnRemoveGuildMember`, `:1406`), so the roster can never reach 0 this way.
   *
   * Returns the guild when the member was removed, undefined otherwise.
   */
  removeMember(guildId: number, characterId: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    const idx = g.members.findIndex((m) => m.characterId === characterId);
    if (idx === -1) return undefined;
    g.members.splice(idx, 1);
    this.stampCooldown(characterId);
    void this.repo?.removeMember(characterId).catch((err: unknown) => {
      logger.error({ err, guildId, characterId }, 'guild member remove persist failed');
    });
    return g;
  }

  /**
   * Disband -- `OnDestroyGuild` (`:1185`). Every member gets the 2-day cooldown
   * (`:1233`). Returns the removed roster so the caller can notify + clear
   * `m_idGuild`, or undefined for an unknown guild.
   */
  destroy(guildId: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    for (const m of g.members) this.stampCooldown(m.characterId);
    this.guilds.delete(guildId);
    this.byName.delete(g.name.toLowerCase());
    void this.repo?.remove(guildId).catch((err: unknown) => {
      logger.error({ err, guildId }, 'guild remove persist failed');
    });
    return g;
  }

  /**
   * Set a member's rank + reset their class to 0 -- `OnGuildMemberLv`
   * (`:1509`). Every permission check is the SERVICE's job; this only records.
   */
  setMemberLevel(guildId: number, characterId: number, memberLv: number): GuildMemberState | undefined {
    const m = this.getMember(guildId, characterId);
    if (!m) return undefined;
    m.memberLv = memberLv;
    m.memberClass = 0; // C++ resets class on every rank change (:1510)
    this.persistMember(characterId, { member_lv: memberLv, class: 0 });
    return m;
  }

  /** Set a member's sub-grade -- `OnGuildClass` (`:1712`). */
  setMemberClass(guildId: number, characterId: number, memberClass: number): GuildMemberState | undefined {
    const m = this.getMember(guildId, characterId);
    if (!m) return undefined;
    m.memberClass = memberClass;
    this.persistMember(characterId, { class: memberClass });
    return m;
  }

  /** Set a member's nickname -- `OnGuildNickName` (`:1836`). */
  setMemberAlias(guildId: number, characterId: number, alias: string): GuildMemberState | undefined {
    const m = this.getMember(guildId, characterId);
    if (!m) return undefined;
    m.alias = alias;
    this.persistMember(characterId, { alias });
    return m;
  }

  /**
   * Transfer mastership -- `OnChgMaster` (`:1750`). The old master drops to
   * GUD_ROOKIE, the new one becomes GUD_MASTER, and BOTH have class reset.
   */
  changeMaster(guildId: number, oldMasterId: number, newMasterId: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    const oldM = this.getMember(guildId, oldMasterId);
    const newM = this.getMember(guildId, newMasterId);
    if (!oldM || !newM) return undefined;
    g.masterId = newMasterId;
    oldM.memberLv = GUD_ROOKIE; oldM.memberClass = 0;
    newM.memberLv = GUD_MASTER; newM.memberClass = 0;
    this.persistUpdate(guildId, { master_id: newMasterId });
    this.persistMember(oldMasterId, { member_lv: GUD_ROOKIE, class: 0 });
    this.persistMember(newMasterId, { member_lv: GUD_MASTER, class: 0 });
    return g;
  }

  /** Rename -- `CGuildMng::SetName`. Fails on a duplicate (case-insensitive). */
  rename(guildId: number, name: string): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    const trimmed = name.trim();
    const clash = this.getByName(trimmed);
    if (clash && clash.id !== guildId) return undefined;
    this.byName.delete(g.name.toLowerCase());
    g.name = trimmed;
    this.byName.set(trimmed.toLowerCase(), guildId);
    this.persistUpdate(guildId, { name: trimmed });
    return g;
  }

  /** `CGuild::SetNotice` (`guild.cpp:607`). */
  setNotice(guildId: number, notice: string): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    g.notice = notice;
    this.persistUpdate(guildId, { notice });
    return g;
  }

  /**
   * `CGuild::SetLogo` (`guild.cpp:516`) -- **write-once**: the C++ refuses when
   * `m_dwLogo` is already nonzero. Returns undefined on that refusal.
   */
  setLogo(guildId: number, logo: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g || g.logo !== 0) return undefined;
    g.logo = logo;
    this.persistUpdate(guildId, { logo });
    return g;
  }

  /** Replace the whole authority mask -- `OnGuildAuthority` (`:1550`). */
  setAuthority(guildId: number, power: readonly number[]): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    const next = new Array<number>(MAX_GM_LEVEL).fill(0);
    for (let i = 0; i < MAX_GM_LEVEL; i++) next[i] = power[i] ?? 0;
    // The master mask is not client-editable in C++ either -- it is hardcoded
    // on create and re-forced on load, so an authority window that zeroes it
    // must not be able to strand the master.
    next[GUD_MASTER] = GUILD_MASTER_POWER;
    g.power = next;
    this.persistUpdate(guildId, {
      power_0: next[0] ?? 0, power_1: next[1] ?? 0, power_2: next[2] ?? 0,
      power_3: next[3] ?? 0, power_4: next[4] ?? 0,
    });
    return g;
  }

  /** Set one rank's daily salary -- `OnGuildPenya` (`:1620`). */
  setRankPenya(guildId: number, rank: number, penya: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g || rank < 0 || rank >= MAX_GM_LEVEL) return undefined;
    g.penya[rank] = penya;
    this.persistUpdate(guildId, { [`penya_${rank}`]: penya });
    return g;
  }

  // ── Contribution / level-up ────────────────────────────────────────────────

  /**
   * `CGuild::CanContribute` (`guild.cpp:554`) -- the refusal ladder, in C++
   * order. Returns {@link CONTRIBUTION_OK} or the first failure.
   *
   * The C++ overflow guards are wraparound tests
   * (`if( m_dwContributionPxp + dwPxp < m_dwContributionPxp )`), which only
   * detect anything because unsigned arithmetic wraps. JS numbers don't wrap, so
   * each becomes an explicit ceiling comparison. The ceilings differ per field
   * on purpose: guild-side pools are `DWORD`, the member's `m_nGiveGold` is a
   * signed `int` (`guild.cpp:588` casts on the way in).
   *
   * Note the max-level check only fires for a PXP contribution: donating pure
   * penya to a level-50 guild is still allowed (it just funds the bank).
   */
  canContribute(guildId: number, characterId: number, pxp: number, penya: number): ContributionResult {
    const g = this.guilds.get(guildId);
    if (!g) return CONTRIBUTION_FAIL_INVALID_CONDITION;
    if (pxp > 0 && g.level >= MAX_GUILD_LEVEL) return CONTRIBUTION_FAIL_MAXLEVEL;
    if (g.contributionPxp + pxp > MAX_DWORD) return CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP;
    if (g.gold + penya > MAX_DWORD) return CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA;
    const m = this.getMember(guildId, characterId);
    if (!m) return CONTRIBUTION_FAIL_INVALID_CONDITION;
    if (m.givePxp + pxp > MAX_DWORD) return CONTRIBUTION_FAIL_OVERFLOW_PXP;
    if (m.giveGold + penya > MAX_INT32) return CONTRIBUTION_FAIL_OVERFLOW_PENYA;
    return CONTRIBUTION_OK;
  }

  /**
   * `CGuild::AddContribution` (`guild.cpp:580`) -- credit the member's counters
   * and the guild pools, then level up ONCE if both thresholds are met.
   *
   * The level-up **consumes** both pools (`-= dwMaxPxp`, `-= dwMaxPenya`), so a
   * guild's bank penya is spent on levelling, not merely gated by it. It is a
   * single `if`, not a `while`: one donation can never skip two levels, and the
   * remainder carries.
   *
   * Returns null when {@link canContribute} refuses, otherwise the new pool
   * state (`leveled` true when the guild advanced) so the caller can push the
   * CONTRIBUTION snapshot without re-reading.
   */
  addContribution(
    guildId: number, characterId: number, pxp: number, penya: number,
  ): { guild: Guild; member: GuildMemberState; leveled: boolean } | null {
    if (this.canContribute(guildId, characterId, pxp, penya) !== CONTRIBUTION_OK) return null;
    const g = this.guilds.get(guildId);
    const m = this.getMember(guildId, characterId);
    if (!g || !m) return null;

    m.givePxp += pxp;
    m.giveGold += penya;
    g.contributionPxp += pxp;
    g.gold += penya;

    let leveled = false;
    if (g.level < MAX_GUILD_LEVEL) {
      const next = GUILD_TABLE[g.level + 1];
      if (next && g.contributionPxp >= next.pxp && g.gold >= next.penya) {
        g.contributionPxp -= next.pxp;
        g.gold -= next.penya;
        g.level++;
        leveled = true;
      }
    }
    this.persistUpdate(guildId, {
      contribution_pxp: g.contributionPxp, gold: g.gold, level: g.level,
    });
    this.persistMember(characterId, { give_pxp: m.givePxp, give_gold: m.giveGold });
    return { guild: g, member: m, leveled };
  }

  /**
   * `CGuild::DecrementMemberContribution` (`guild.cpp:540`) -- the rollback the
   * world server calls when a contribution was credited on the core but the
   * player's own penya/item removal then failed. Kept because the same
   * ordering hazard exists here (`spendGold` can still refuse after the pools
   * moved), and it deliberately does NOT un-level the guild -- neither does C++.
   */
  decrementMemberContribution(
    guildId: number, characterId: number, pxp: number, penya: number,
  ): void {
    const m = this.getMember(guildId, characterId);
    if (!m) return;
    m.givePxp -= pxp;
    m.giveGold -= penya;
    this.persistMember(characterId, { give_pxp: m.givePxp, give_gold: m.giveGold });
  }

  /**
   * The 21:00 salary sweep -- `CGuildMng::Process` (`guild.cpp:1089`).
   *
   * Per guild: sum `m_adwPenya[rank]` across the whole roster (offline members
   * included -- C++ iterates `m_mapPMember`, not the online set), and pay out
   * only when `0 < total <= m_nGoldGuild`. A guild that cannot afford its full
   * payroll pays nobody, rather than paying partially.
   *
   * `m_bSendPay` is the once-per-day latch: set on payout, cleared by
   * {@link resetSalaryLatch} at hour 22. Returns the guilds that actually paid,
   * with the amount, so the caller can push GUILD_REAL_PENYA.
   */
  paySalaries(): { guild: Guild; total: number }[] {
    const paid: { guild: Guild; total: number }[] = [];
    for (const g of this.guilds.values()) {
      if (g.sentPay) continue;
      let total = 0;
      for (const m of g.members) total += g.penya[m.memberLv] ?? 0;
      if (total <= 0 || total > g.gold) continue;
      g.sentPay = true;
      g.gold -= total;
      // Each member's lifetime `m_nPay` grows by their own rank's salary.
      for (const m of g.members) {
        const amount = g.penya[m.memberLv] ?? 0;
        if (amount <= 0) continue;
        m.pay += amount;
        this.persistMember(m.characterId, { pay: m.pay });
      }
      this.persistUpdate(g.id, { gold: g.gold });
      paid.push({ guild: g, total });
    }
    return paid;
  }

  /** Clear every `m_bSendPay` latch -- the hour-22 half of `Process`. */
  resetSalaryLatch(): void {
    for (const g of this.guilds.values()) g.sentPay = false;
  }

  /**
   * Set the guild bank penya pool (`m_nGoldGuild`) absolutely.
   *
   * Deliberately absolute rather than a delta: the same field is the level-up
   * currency (`AddContribution` spends it) AND the bank balance, so the bank
   * withdrawal path reads the current value, subtracts, and writes back through
   * here. Clamped at 0 -- C++ pre-checks `nGold > m_nGoldGuild` at every call
   * site, so a negative pool is unreachable there and must stay unreachable here.
   */
  setGold(guildId: number, gold: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    g.gold = Math.max(0, gold);
    this.persistUpdate(guildId, { gold: g.gold });
    return g;
  }


  // ── Guild war state ────────────────────────────────────────────────────────

  /**
   * Enter a war -- the `pDecl->m_idWar = idWar; pDecl->m_idEnemyGuild = ...`
   * block of `OnAcptWar` (`DPCacheSrvr.cpp:2568-2571`). Both fields are set
   * together because `m_idWar` decides participation and `m_idEnemyGuild` is
   * what the client is told.
   */
  setWar(guildId: number, warId: number, enemyGuildId: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    g.idWar = warId;
    g.idEnemyGuild = enemyGuildId;
    return g;
  }

  /**
   * Leave a war -- the cleanup block of `CGuildWarMng::Result`
   * (`guildwar.cpp:226-229`), which clears BOTH sides regardless of who won.
   * Neither field is persisted, so there is no write-through here.
   */
  clearWar(guildId: number): Guild | undefined {
    const g = this.guilds.get(guildId);
    if (!g) return undefined;
    g.idWar = 0;
    g.idEnemyGuild = 0;
    return g;
  }

  /**
   * Apply a war result to one guild's record -- the `__CORESERVER` arm of
   * `Result` (`guildwar.cpp:199-216`).
   *
   * The winner's gain is the C++ formula verbatim, including its oddities: the
   * divisor `((win + 4) / (lose + 1)) * 0.05` means a strong guild beating a
   * weak one gains LESS, and the `+ 1` at the tail makes the minimum gain
   * non-zero. It is then capped at `(10 + win * 0.05) * 5`. The loser drops
   * `10 + theirs * 0.02`, floored at 0 (`:214`).
   *
   * Returns the actual win-point delta applied to the winner, which the WAR_END
   * packet carries.
   */
  applyWarResult(winnerId: number, loserId: number): number {
    const win = this.guilds.get(winnerId);
    const lose = this.guilds.get(loserId);
    if (!win || !lose) return 0;

    // `(int)( wp + ( (10 + wp) / (((wp + 4) / (lp + 1)) * 0.05) ) + 1 )`.
    const ratio = ((win.winPoint + 4) / (lose.winPoint + 1)) * 0.05;
    const gain = Math.trunc(win.winPoint + (10 + win.winPoint) / ratio + 1);
    const maxGain = Math.trunc((10 + win.winPoint * 0.05) * 5);
    const applied = gain > maxGain ? maxGain : gain;
    win.winPoint += applied;
    win.win += 1;

    const drop = Math.trunc(10 + lose.winPoint * 0.02);
    lose.winPoint = Math.max(0, lose.winPoint - drop);
    lose.lose += 1;

    this.persistUpdate(winnerId, { win_point: win.winPoint, win: win.win });
    this.persistUpdate(loserId, { win_point: lose.winPoint, lose: lose.lose });
    return applied;
  }

  /**
   * `pMember->m_nSurrender++` plus the guild-level counter -- `OnSurrender`
   * (`DPCacheSrvr.cpp:2305`, `:2321`). C++ bumps only the member row there; the
   * guild's own `m_nSurrender` has no writer anywhere in the tree, so it stays
   * whatever the DB holds. Faithful: the guild counter is left alone.
   */
  addMemberSurrender(guildId: number, characterId: number): GuildMemberState | undefined {
    const m = this.getMember(guildId, characterId);
    if (!m) return undefined;
    m.surrender += 1;
    this.persistMember(characterId, { surrender: m.surrender });
    return m;
  }

  // ── Quest ledger ───────────────────────────────────────────────────────────

  /** `CGuild::FindQuest` (`guild.cpp:966-979`), minus its `m_pQuest` cache. */
  getQuest(guildId: number, questId: number): GuildQuestState | undefined {
    return this.guilds.get(guildId)?.quests.find((q) => q.questId === questId);
  }

  /**
   * `CGuild::SetQuest` (`guild.cpp:909-944`) -- find-or-append, then notify.
   *
   * C++ walks `m_aQuest` for a matching `nId`, else reuses the first slot whose
   * `nId == -1`, else appends and bumps `m_nQuestSize`. We collapse the
   * tombstone-reuse arm because {@link removeQuest} really deletes: a UNIQUE
   * `(guild_id, quest_id)` row plus a real delete is the relational equivalent
   * of reusing a `-1` slot, and it keeps the serialized array free of holes the
   * client would have to skip.
   *
   * The 255 bound is `m_nQuestSize` being a **BYTE** (`guild.h:348`) against
   * `MAX_GUILD_QUEST == 256` (`guildquest.h:10`) -- the original's own count
   * wraps at 256. Defensive only: the shipped data defines one quest.
   *
   * Returns the entry, or undefined when the guild is unknown or the ledger is
   * full.
   */
  setQuest(guildId: number, questId: number, state: number): GuildQuestState | undefined {
    const guild = this.guilds.get(guildId);
    if (!guild) return undefined;
    const existing = guild.quests.find((q) => q.questId === questId);
    if (existing) {
      existing.state = state;
      this.persistQuest(guildId, questId, state);
      return existing;
    }
    if (guild.quests.length >= 255) {
      logger.warn({ guildId, questId }, 'guild quest ledger full -- entry dropped');
      return undefined;
    }
    const entry: GuildQuestState = { questId, state };
    guild.quests.push(entry);
    this.persistQuest(guildId, questId, state);
    return entry;
  }

  /**
   * Drop an entry.
   *
   * The original tombstones instead (`CGuild::RemoveQuest`, `guild.cpp:946-964`,
   * sets `nId = -1` in place) and never tells the client: that function has an
   * unconditional `return TRUE;` at `:952`, ABOVE its
   * `SNAPSHOTTYPE_REMOVEGUILDQUEST` notify loop, so the whole fan-out is dead
   * code and clients only learn of a removal at the next full guild serialize.
   * We match the silence -- see the opcode note on `REMOVEGUILDQUEST` -- while
   * deleting the row rather than holing the array.
   */
  removeQuest(guildId: number, questId: number): boolean {
    const guild = this.guilds.get(guildId);
    if (!guild) return false;
    const i = guild.quests.findIndex((q) => q.questId === questId);
    if (i < 0) return false;
    guild.quests.splice(i, 1);
    if (this.questRepo) {
      void this.questRepo.remove(guildId, questId)
        .catch((err: unknown) => logger.warn({ err, guildId, questId }, 'guild quest remove failed'));
    }
    return true;
  }

  private persistQuest(guildId: number, questId: number, state: number): void {
    if (!this.questRepo) return;
    void this.questRepo.upsert(guildId, questId, state)
      .catch((err: unknown) => logger.warn({ err, guildId, questId }, 'guild quest upsert failed'));
  }

  // ── Rejoin cooldown ────────────────────────────────────────────────────────

  /** Stamp `now + 2 days` on a departing member (`:1233`, `:1421`). */
  stampCooldown(characterId: number): void {
    const until = this.now() + GUILD_REJOIN_COOLDOWN_MS;
    this.cooldowns.set(characterId, until);
    void this.repo?.setCooldown(characterId, until).catch((err: unknown) => {
      logger.error({ err, characterId }, 'guild cooldown persist failed');
    });
  }

  /** Is this character still locked out? Expired entries are swept on read. */
  onCooldown(characterId: number): boolean {
    const until = this.cooldowns.get(characterId);
    if (until === undefined) return false;
    if (until <= this.now()) { this.cooldowns.delete(characterId); return false; }
    return true;
  }

  // ── Pending invites ────────────────────────────────────────────────────────

  hasPending(targetId: number): boolean { return this.pending.has(targetId); }
  getPending(targetId: number): PendingGuildInvite | undefined { return this.pending.get(targetId); }
  addPending(inv: PendingGuildInvite): void { this.pending.set(inv.targetId, inv); }

  /** Remove + clear the timer. Returns the removed entry (or undefined). */
  removePending(targetId: number): PendingGuildInvite | undefined {
    const e = this.pending.get(targetId);
    if (!e) return undefined;
    clearTimeout(e.timer);
    this.pending.delete(targetId);
    return e;
  }

  /** Disconnect hook -- drop invites referencing `characterId` either way. */
  onDisconnect(characterId: number): void {
    this.removePending(characterId);
    for (const [targetId, inv] of this.pending) {
      if (inv.inviterId === characterId) { clearTimeout(inv.timer); this.pending.delete(targetId); }
    }
  }

  // ── Persistence (fire-and-forget) ──────────────────────────────────────────

  private persistCreate(g: Guild): void {
    void this.repo?.create({
      id: g.id, name: g.name, masterId: g.masterId, level: g.level, logo: g.logo,
      contributionPxp: g.contributionPxp, gold: g.gold, notice: g.notice,
      power: [...g.power], penya: [...g.penya],
      win: g.win, lose: g.lose, surrender: g.surrender,
      winPoint: g.winPoint,
      members: g.members.map((m) => ({ ...m })),
    }).catch((err: unknown) => {
      logger.error({ err, guildId: g.id }, 'guild create persist failed');
    });
  }

  private persistUpdate(guildId: number, data: Record<string, number | string>): void {
    void this.repo?.update(guildId, data).catch((err: unknown) => {
      logger.error({ err, guildId }, 'guild update persist failed');
    });
  }

  private persistMember(characterId: number, data: Record<string, number | string>): void {
    void this.repo?.updateMember(characterId, data).catch((err: unknown) => {
      logger.error({ err, characterId }, 'guild member update persist failed');
    });
  }
}

/** A fresh roster entry at `rank`, all counters zeroed. */
function newMember(characterId: number, rank: number): GuildMemberState {
  return {
    characterId, memberLv: rank, memberClass: 0, pay: 0,
    giveGold: 0, givePxp: 0, win: 0, lose: 0, surrender: 0,
    alias: '', selectedVoteId: 0,
  };
}
