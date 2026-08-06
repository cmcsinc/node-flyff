/**
 * GuildQuestProcessor -- the live guild-quest arena registry.
 *
 * Port of `CGuildQuestProcessor` (`_Common/guildquest.cpp`, whole file, behind
 * `#ifdef __WORLDSERVER`). C++ makes it a function-local static singleton
 * (`GetInstance`, `:255-259`); here it is a composed instance so tests can hold
 * their own.
 *
 * Two tables, and the distinction matters:
 *
 * - **`m_pRect[]`** -- the quest RECTS, registered once at prop-load time
 *   (`CProject::LoadPropGuildQuest` calls `AddQuestRect` inline while parsing,
 *   `Project.cpp:1260`). Static for the life of the process. Here it is derived
 *   from {@link GuildQuestProp.rect} on construction rather than pushed in by
 *   the loader, which keeps the parse side free of world state.
 * - **`m_pElem[]`** -- the live arena state, one slot per quest id, `nId == -1`
 *   meaning free. C++ indexes a fixed 256-entry array by quest id and tests
 *   `pElem->nId == i` to find live ones (`:27`); a Map keyed by quest id is the
 *   same thing without the sentinel.
 *
 * **Concurrency is per quest id, server-wide.** `IsQuesting` tests one global
 * slot (`:242-253`), so with exactly one quest defined in the shipped data, one
 * guild holds the arena for the whole world at a time. That is the original's
 * behaviour, not a simplification.
 *
 * The state machine is two phases with a deadline each:
 *
 * ```text
 *   MonHuntStart -> GQP_WORMON  (60 min, guildquest.cpp:200)
 *        boss dies -> GQP_GETITEM (20 min, Mover.cpp:7505)
 *        deadline passes, or nobody left in the rect -> removed
 * ```
 *
 * @module managers/guildQuest
 */

import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'guild-quest' });

/** `GQP_READY` / `GQP_WORMON` / `GQP_GETITEM` (`guildquest.h:55-58`). */
export const GQP_READY = 0;
export const GQP_WORMON = 1;
export const GQP_GETITEM = 2;

/**
 * Boss-kill deadline -- `MIN( 60 )` (`guildquest.cpp:200`).
 *
 * The commented-out `__INTERNALSERVER` arm above it uses `MIN( 10 )`; the live
 * build is 60.
 */
export const GUILD_QUEST_WORMON_MS = 60 * 60 * 1000;

/** Loot-window deadline after the boss dies -- `MIN( 20 )` (`Mover.cpp:7505`). */
export const GUILD_QUEST_GETITEM_MS = 20 * 60 * 1000;

/**
 * Presence-scan debounce -- `if( ++pElem->nCount < 10 ) continue;`
 * (`guildquest.cpp:88`).
 *
 * This is NOT kill progress. It stops the "is anyone still alive in the arena"
 * scan from firing on the very first tick after a spawn, before the teleported
 * members have arrived. C++ never resets it, so it debounces once per arena
 * instance rather than once per scan.
 */
export const GUILD_QUEST_SCAN_DEBOUNCE = 10;

/** An axis-aligned rect in world x/z, after the y-swap. */
export interface QuestRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * `GUILDQUESTELEM` (`guildquest.h:60-78`) -- one live arena.
 *
 * `ns`/`nf` are the two quest states the dialog passes through `MonHuntStart`:
 * `ns` on success (boss killed) and `nf` on failure (timeout or wipe). The
 * shipped call is `MonHuntStart( QUEST_WARMON_LV1, QS_BEGIN, QS_END, 1 )`
 * (`NpcScript.cpp:2061`), so `ns == QS_END == 14` and `nf == 1`.
 */
export interface GuildQuestElem {
  /** `nId` -- the quest id. */
  readonly questId: number;
  /** `nState` -- the state at start. Zeroed when the boss dies (`Mover.cpp:7507`). */
  state: number;
  /** `idGuild` -- the guild that STARTED the arena. */
  readonly guildId: number;
  /** `nProcess` -- `GQP_WORMON` or `GQP_GETITEM`. */
  process: number;
  /** `dwEndTime` -- absolute epoch ms deadline. */
  endsAt: number;
  /** `ns` -- state written on success. */
  ns: number;
  /** `nf` -- state written on failure. */
  nf: number;
  /** `objidWormon` -- the boss's objid; `undefined` once it is dead. */
  bossObjid: number | undefined;
  /** `nCount` -- the presence-scan debounce (see {@link GUILD_QUEST_SCAN_DEBOUNCE}). */
  count: number;
}

/** The prop fields this manager needs -- a subset of `GuildQuestProp`. */
export interface GuildQuestPropLike {
  readonly id: number;
  readonly worldId: number;
  readonly wormonId: number;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly rect: QuestRect;
}

export class GuildQuestProcessor {
  /** `m_pElem[]`, keyed by quest id. */
  private readonly elems = new Map<number, GuildQuestElem>();
  /** `m_pRect[]` + the props behind them, keyed by quest id. */
  private readonly props = new Map<number, GuildQuestPropLike>();

  /**
   * @param props - Every defined guild quest. Its rects become the static rect
   *   table, exactly as `AddQuestRect` is called during the prop parse.
   * @param now - Clock seam for tests.
   */
  constructor(props: Iterable<GuildQuestPropLike> = [], private readonly now: () => number = Date.now) {
    for (const p of props) this.props.set(p.id, p);
  }

  /** `prj.GetGuildQuestProp( nQuestId )` (`Project.cpp:5212`). */
  getProp(questId: number): GuildQuestPropLike | undefined { return this.props.get(questId); }

  /** Every defined quest -- the region-suppression scan needs them all. */
  allProps(): GuildQuestPropLike[] { return [...this.props.values()]; }

  /** `GetGuildQuest` (`:210-221`) -- undefined rather than the `nId == -1` NULL. */
  get(questId: number): GuildQuestElem | undefined { return this.elems.get(questId); }

  /** Every live arena -- the `Process` walk. */
  all(): GuildQuestElem[] { return [...this.elems.values()]; }

  /**
   * `IsQuesting` (`:242-253`) -- is this quest id occupied by ANY guild?
   *
   * Deliberately not per-guild: the C++ test is on the global slot, which is
   * what makes the arena world-exclusive.
   */
  isQuesting(questId: number): boolean { return this.elems.has(questId); }

  /**
   * `SetGuildQuest` (`:176-208`) -- open an arena.
   *
   * Rejects an unknown quest id (C++ calls `Error("")` and returns). Overwrites
   * an existing slot the way C++ does -- the caller is responsible for the
   * `IsQuesting` check, and `MonHuntStart` makes it (`ScriptLib.cpp:446`).
   */
  open(
    questId: number, state: number, ns: number, nf: number,
    guildId: number, bossObjid: number,
  ): GuildQuestElem | undefined {
    if (!this.props.has(questId)) {
      logger.warn({ questId }, 'guild quest has no prop -- not opened');
      return undefined;
    }
    const elem: GuildQuestElem = {
      questId, state, guildId,
      process: GQP_WORMON,
      endsAt: this.now() + GUILD_QUEST_WORMON_MS,
      ns, nf,
      bossObjid,
      count: 0,
    };
    this.elems.set(questId, elem);
    logger.info({ questId, guildId, bossObjid }, 'guild quest arena opened');
    return elem;
  }

  /**
   * The boss-death transition -- `CMover::DropItem`'s guild arm
   * (`Mover.cpp:7493-7511`).
   *
   * Zeroes `ns`/`nf`/`nState` and drops the boss objid exactly as C++ does
   * (`:7506-7508`), so a second death event on the same arena is inert. The
   * caller has already written `ns` to the guild ledger.
   */
  toGetItem(elem: GuildQuestElem): void {
    elem.process = GQP_GETITEM;
    elem.endsAt = this.now() + GUILD_QUEST_GETITEM_MS;
    elem.ns = 0;
    elem.nf = 0;
    elem.state = 0;
    elem.bossObjid = undefined;
  }

  /** `RemoveGuildQuest` (`:223-240`). C++ resets the slot in place; we drop it. */
  close(questId: number): boolean {
    const gone = this.elems.delete(questId);
    if (gone) logger.info({ questId }, 'guild quest arena closed');
    return gone;
  }

  /** Has this arena's deadline passed? `pElem->dwEndTime < dwTickCount` (`:37`). */
  isExpired(elem: GuildQuestElem, nowMs: number = this.now()): boolean {
    return elem.endsAt < nowMs;
  }

  /**
   * Bump the presence-scan debounce; true once it has cleared.
   *
   * `++pElem->nCount < 10` -> skip (`:88`). C++ never resets `nCount`, so after
   * the tenth tick every subsequent tick scans.
   */
  bumpScan(elem: GuildQuestElem): boolean {
    elem.count += 1;
    return elem.count >= GUILD_QUEST_SCAN_DEBOUNCE;
  }

  /**
   * `PtInQuestRect` (`:274-284`) -- which quest's rect contains this point, or
   * undefined.
   *
   * Tests **x and z**, not y (`:276`) -- the rect is a ground footprint, so a
   * flying player above the arena is inside it.
   */
  rectAt(pos: { x: number; z: number }, worldId?: number): number | undefined {
    for (const p of this.props.values()) {
      if (worldId !== undefined && p.worldId !== worldId) continue;
      if (ptInRect(p.rect, pos)) return p.id;
    }
    return undefined;
  }

  /** `GetQuestRect( nId )` (`:286-294`). */
  rectOf(questId: number): QuestRect | undefined { return this.props.get(questId)?.rect; }

  /**
   * `CProject::IsGuildQuestRegion` (`Project.cpp:4635-4652`).
   *
   * Scans the PROP table, not the live arenas -- so the rect suppresses
   * teleports and summons whether or not a quest is running. That is why it is
   * separate from {@link rectAt} despite the identical geometry.
   */
  isQuestRegion(pos: { x: number; z: number }, worldId?: number): boolean {
    return this.rectAt(pos, worldId) !== undefined;
  }
}

/**
 * `CRect::PtInRect` -- left/top INCLUSIVE, right/bottom EXCLUSIVE (Win32
 * semantics, and the reason the y-swap has to happen first: an unswapped rect
 * has `top > bottom` and `PtInRect` returns false for every point).
 */
export function ptInRect(r: QuestRect, pos: { x: number; z: number }): boolean {
  return pos.x >= r.left && pos.x < r.right && pos.z >= r.top && pos.z < r.bottom;
}
