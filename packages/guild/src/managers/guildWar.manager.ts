/**
 * GuildWarManager -- the live war registry.
 *
 * Port of `CGuildWarMng` (`_Common/guildwar.cpp:92-344`). Keyed by **war id**,
 * not guild id: `GetWar( u_long idWar )` is a `map<u_long, CGuildWar*>` lookup
 * (`:131-137`), and both `CGuild::m_idWar` and `CMover::m_idWar` are indexes
 * into it. That indirection is load-bearing -- `CGuild::GetWar()`
 * (`guild.cpp:678-682`) is a registry lookup, so a guild whose `m_idWar` names
 * a war that no longer exists reads as NOT at war rather than crashing.
 *
 * `nAbsent` deserves a note. In C++ `Process()` is called from the world main
 * loop with **no timeout guard** (`ThreadMng.cpp:466`, inside a
 * `WaitForSingleObject(..., 1)` loop), so it increments roughly a thousand times
 * a second while a guild master is offline. Nothing reads the absolute value --
 * `OnWarTimeout` only compares the two sides (`DPCoreSrvr.cpp:1722`) -- so this
 * port ticks once per second instead. The comparison is preserved; the number
 * becomes seconds-offline, which is what the field always meant.
 *
 * The declare/accept flow lives in `GuildService`, not here: it needs the guild
 * registry, the roster, and the send paths. This class owns only the war records
 * and their lifecycle.
 *
 * @module managers/guildWar
 */

import {
  WF_WARTIME, WF_END,
  WR_TRUCE, WR_DECL_AB, WR_ACPT_AB, WR_DECL_DD, WR_ACPT_DD, WR_DRAW,
  GUILD_WAR_DURATION_MS,
  type GuildWarSnapshot, type WarEntry,
} from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'guild-war-manager' });

/**
 * One live war. Mutable mirror of {@link GuildWarSnapshot} (which is the
 * read-only wire shape) plus the sub-second absence accumulator.
 */
export interface War {
  readonly id: number;
  decl: WarEntry;
  acpt: WarEntry;
  /** `m_nFlag` -- WF_WARTIME while live, WF_END once timed out. */
  flag: number;
  /** `m_time` -- start, UNIX seconds. */
  readonly startedAtSec: number;
  /**
   * Millisecond remainders for the two `nAbsent` accumulators, so a 50ms tick
   * still yields exactly one increment per second. Not persisted: losing up to
   * 999ms of absence across a restart cannot change a comparison that is
   * measured in minutes.
   */
  absentMsDecl: number;
  absentMsAcpt: number;
}

/**
 * Persistence port -- structurally satisfied by `GuildWarRepository`
 * (`@flyff/database`). An interface so the manager stays testable with a plain
 * object and carries no Knex knowledge, matching `GuildPersistence`.
 */
export interface GuildWarPersistence {
  loadAll(): Promise<GuildWarSnapshot[]>;
  maxId(): Promise<number>;
  create(war: GuildWarSnapshot): Promise<void>;
  update(warId: number, data: Record<string, number>): Promise<void>;
  remove(warId: number): Promise<void>;
}

/** One second of absence -- the normalized `nAbsent` increment period. */
const ABSENT_TICK_MS = 1000;

/** A fresh zeroed side. `size` is the frozen roster headcount. */
function newSide(guildId: number, size: number): WarEntry {
  return { guildId, size, surrender: 0, dead: 0, absent: 0 };
}

export class GuildWarManager {
  private readonly wars = new Map<number, War>();
  /** `m_id` -- the last id issued. `AddWar` bumps it (`guildwar.cpp:111`). */
  private nextId = 0;

  constructor(
    private readonly repo?: GuildWarPersistence,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * World-boot hydrate -- the port of `CDbManager::OpenGuildWar`. Reloads every
   * live war and seeds the id counter past the highest stored id (C++ reads
   * `Max_m_idWar` for exactly this).
   *
   * Re-deriving the two guilds' `m_idWar` / `m_idEnemyGuild` back-links is the
   * caller's job (C++ does it in the same load loop, but that needs the guild
   * registry, which this class does not hold).
   */
  async hydrate(): Promise<void> {
    if (!this.repo) return;
    for (const w of await this.repo.loadAll()) {
      this.wars.set(w.id, {
        id: w.id, decl: { ...w.decl }, acpt: { ...w.acpt },
        flag: w.flag, startedAtSec: w.startedAtSec,
        absentMsDecl: 0, absentMsAcpt: 0,
      });
    }
    this.nextId = Math.max(await this.repo.maxId(), this.nextId);
    logger.info({ wars: this.wars.size, nextId: this.nextId }, 'guild wars hydrated');
  }

  /**
   * `CGuildWarMng::AddWar` (`guildwar.cpp:109-117`) -- create a war between two
   * guilds and return its id, or 0 on collision.
   *
   * The id allocator is verbatim-odd and kept that way: `m_id` is set to the
   * war's own id when it already has one (the DB-load path), else bumped. So
   * loading a war with id 7 rewinds the counter to 7, and the collision test
   * that follows is what stops the next allocation from reusing it.
   *
   * `size` is a SNAPSHOT of each roster taken here and never recomputed --
   * `OnSurrender` divides by it (`DPCacheSrvr.cpp:2312`), so a live count would
   * let a guild dodge the 70% threshold by recruiting mid-war.
   */
  addWar(declGuildId: number, declSize: number, acptGuildId: number, acptSize: number): number {
    const id = this.nextId + 1;
    if (this.wars.has(id)) return 0;
    this.nextId = id;
    const war: War = {
      id,
      decl: newSide(declGuildId, declSize),
      acpt: newSide(acptGuildId, acptSize),
      flag: WF_WARTIME,
      startedAtSec: Math.floor(this.now() / 1000),
      absentMsDecl: 0, absentMsAcpt: 0,
    };
    this.wars.set(id, war);
    this.persistCreate(war);
    return id;
  }

  /** `CGuildWarMng::GetWar` -- the registry lookup. */
  get(warId: number): War | undefined {
    return this.wars.get(warId);
  }

  /**
   * `CGuildWarMng::RemoveWar` (`:119-129`) -- the tail of every termination.
   * Returns whether a war was actually removed, like the C++ BOOL.
   */
  removeWar(warId: number): boolean {
    if (!this.wars.delete(warId)) return false;
    this.persist(() => this.repo?.remove(warId), warId, 'remove');
    return true;
  }

  /** Every live war. Iteration order is insertion order (C++ uses id order). */
  all(): readonly War[] {
    return [...this.wars.values()];
  }

  /** `CGuildWar::IsDecl` -- is this guild the declaring side? */
  isDecl(war: War, guildId: number): boolean {
    return war.decl.guildId === guildId;
  }

  /** The side record for a guild, or undefined when it is not in this war. */
  sideOf(war: War, guildId: number): WarEntry | undefined {
    if (war.decl.guildId === guildId) return war.decl;
    if (war.acpt.guildId === guildId) return war.acpt;
    return undefined;
  }

  /**
   * `CGuildWar::GetEndTime` (`guildwar.h:64`) -- start + 2 hours. The
   * `__INTERNALSERVER` 10-minute arm is dead in this tree (see
   * {@link GUILD_WAR_DURATION_MS}).
   */
  endTimeMs(war: War): number {
    return war.startedAtSec * 1000 + GUILD_WAR_DURATION_MS;
  }

  /** Has this war run past its two hours? */
  isExpired(war: War, nowMs = this.now()): boolean {
    return war.flag === WF_WARTIME && this.endTimeMs(war) < nowMs;
  }

  /**
   * `m_nFlag = WF_END` -- the timeout latch (`CGuildWar::Process`,
   * `guildwar.cpp:70`). Separate from resolution: C++ sets the flag world-side
   * and sends `SendWarTimeout` to CoreServer, which then decides the winner. In
   * this single process the service does both, but the latch stays so a war
   * cannot be counted twice.
   */
  markEnded(war: War): void {
    war.flag = WF_END;
    this.persist(() => this.repo?.update(war.id, { flag: WF_END }), war.id, 'flag');
  }

  /**
   * `nSurrender++` on one side -- `OnSurrender` (`DPCacheSrvr.cpp:2306`,
   * `:2322`). Returns the new count.
   */
  addSurrender(war: War, guildId: number): number {
    const side = this.sideOf(war, guildId);
    if (!side) return 0;
    side.surrender += 1;
    const col = this.isDecl(war, guildId) ? 'decl_surrender' : 'acpt_surrender';
    this.persist(() => this.repo?.update(war.id, { [col]: side.surrender }), war.id, col);
    return side.surrender;
  }

  /** `nDead++` -- `OnWarDead` (`DPCoreSrvr.cpp:1653`, `:1658`). */
  addDead(war: War, guildId: number): number {
    const side = this.sideOf(war, guildId);
    if (!side) return 0;
    side.dead += 1;
    const col = this.isDecl(war, guildId) ? 'decl_dead' : 'acpt_dead';
    this.persist(() => this.repo?.update(war.id, { [col]: side.dead }), war.id, col);
    return side.dead;
  }

  /**
   * Accumulate master-absence for one side and return how many whole seconds
   * were added (0 most ticks). The port of `SendWarMasterAbsent` ->
   * `OnWarMasterAbsent` (`DPCoreSrvr.cpp:1688-1697`), rate-normalized per the
   * module note.
   */
  addAbsent(war: War, isDeclSide: boolean, dtMs: number): number {
    const key = isDeclSide ? 'absentMsDecl' : 'absentMsAcpt';
    war[key] += dtMs;
    const ticks = Math.floor(war[key] / ABSENT_TICK_MS);
    if (ticks <= 0) return 0;
    war[key] -= ticks * ABSENT_TICK_MS;
    const side = isDeclSide ? war.decl : war.acpt;
    side.absent += ticks;
    const col = isDeclSide ? 'decl_absent' : 'acpt_absent';
    this.persist(() => this.repo?.update(war.id, { [col]: side.absent }), war.id, col);
    return ticks;
  }

  /**
   * `CDPCoreSrvr::OnWarTimeout` (`DPCoreSrvr.cpp:1701-1750`) -- resolve an
   * expired war into a WR_* result, WITHOUT applying it.
   *
   * The cascade is absence first, then deaths, then a draw. Note the polarity:
   * the side with MORE absence LOSES, so more `decl` absence yields
   * `WR_ACPT_AB`. Same for deaths. The commented-out `WR_*_GN` lines beside
   * each branch in the original are a reminder that AB/DD are cosmetic
   * distinctions -- `Result` treats every value below `WR_TRUCE` identically,
   * and the DB path even folds them back to `_GN` (`guildwar.cpp:268-278`).
   */
  resolveTimeout(war: War): number {
    if (war.decl.absent > war.acpt.absent) return WR_ACPT_AB;
    if (war.decl.absent < war.acpt.absent) return WR_DECL_AB;
    if (war.decl.dead > war.acpt.dead) return WR_ACPT_DD;
    if (war.decl.dead < war.acpt.dead) return WR_DECL_DD;
    return WR_DRAW;
  }

  /**
   * Does this result type change the two guilds' records?
   * `CGuildWarMng::Result` gates the whole win/lose block on
   * `nType < WR_TRUCE` (`guildwar.cpp:195`), so TRUCE and DRAW end the war and
   * clear both sides' state while leaving win/lose/win-point untouched.
   */
  isScoring(resultType: number): boolean {
    return resultType < WR_TRUCE;
  }

  /** The wire shape for `buildMyGuildWar`. */
  snapshot(war: War): GuildWarSnapshot {
    return {
      id: war.id, decl: { ...war.decl }, acpt: { ...war.acpt },
      flag: war.flag, startedAtSec: war.startedAtSec,
    };
  }

  private persistCreate(war: War): void {
    this.persist(() => this.repo?.create(this.snapshot(war)), war.id, 'create');
  }

  /**
   * Fire-and-forget write. A DB failure must never break a live war broadcast,
   * so each rejection becomes a log line -- the same contract as
   * `GuildManager`.
   */
  private persist(fn: () => Promise<void> | undefined, warId: number, what: string): void {
    try {
      void fn()?.catch((err: unknown) => logger.warn({ err, warId, what }, 'guild war persist failed'));
    } catch (err) {
      logger.warn({ err, warId, what }, 'guild war persist threw');
    }
  }
}
