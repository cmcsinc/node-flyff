/**
 * GuildQuestService -- the guild-quest boss arena.
 *
 * Collapses four C++ sites: the script entry point (`MonHuntStart`,
 * `_Common/ScriptLib.cpp:443-492`), the arena tick
 * (`CGuildQuestProcessor::Process`, `guildquest.cpp:21-174`), the boss-death
 * transition (`CMover::DropItem`'s guild arm, `Mover.cpp:7493-7511`), and the
 * two ejection helpers (`CGuild::ReplaceLodestar`, `guild.cpp:982-1010`;
 * `CUser::AdjustGuildQuest`, `User.cpp:3652-3690`).
 *
 * **The whole feature is one boss with no rewards.** `propGuildQuest.inc` ships
 * exactly one entry -- one monster, one Madrigal rect. `GUILDQUESTPROP` has no
 * reward field, and nothing on the completion path grants penya, exp, or an
 * item; the boss's ordinary drop table is the only payout. Completion advances
 * `nState` and nothing else. Ported as-is: inventing rewards would be designing.
 *
 * **Two deliberate divergences from the C++.** Both recorded in
 * `docs/c++-fidelity-audit.md`; each site carries a `divergence:` comment.
 *
 * 1. **Completion credits the QUESTING guild, not the killer's.**
 *    `Mover.cpp:7499` reads `pAttacker->GetGuild()` and never compares it to
 *    `pElem->idGuild`, so any guild that lands the killing blow takes the
 *    completion -- an outside guild can walk into an arena it did not open and
 *    steal it, and a guildless killer voids it entirely (the whole block is
 *    skipped, leaving the arena stuck in `GQP_WORMON` with a dangling boss
 *    objid until its 60 minutes elapse). We credit `elem.guildId`.
 *
 * 2. **Start is gated on master + level server-side.** `MonHuntStart` checks
 *    only "not already questing / has a guild / prop exists"
 *    (`ScriptLib.cpp:446-457`) -- no master check, no level check. Every real
 *    gate lives in the dialog script (`NpcScript.cpp:1977`: `GetPlayerLvl() >=
 *    70 && IsWormonServer() == TRUE && IsGuild() == 1 && IsGuildMaster() == 1`).
 *    A script predicate is a client-visible branch, not an authority check, so
 *    reproducing that split would let any member at any level open the arena
 *    through a crafted dialog step. The gates are enforced here as well.
 *
 * Faithful, deliberately: the y-swapped rect, the 60-minute boss deadline and
 * 20-minute loot window, the ten-tick presence debounce, the world-exclusive
 * one-arena-per-quest-id rule, and the silence -- no packet tells the client
 * about the timers, because the original has none (contrast the party path,
 * which does send `SendQuestLimitTime`, `Mover.cpp:7528`).
 *
 * @module services/guildQuest
 */

import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import { buildSetGuildQuest } from '@flyff/world-core';
import { QS_BEGIN } from '@flyff/core/constants/quest';
import { createLogger } from '@flyff/core/logger';
import type { GuildManager, Guild } from '../managers/guild.manager';
import {
  GuildQuestProcessor, GQP_WORMON, GQP_GETITEM,
  type GuildQuestElem, type QuestRect,
} from '../managers/guildQuest.manager';

const logger = createLogger({ module: 'guild-quest-service' });

/**
 * The level the shipped dialog gate requires -- a literal in the script
 * (`NpcScript.cpp:1977`), NOT `GUILDQUESTPROP::nLevel`, which is parsed and read
 * by nothing. Enforced here as divergence 2.
 */
export const GUILD_QUEST_MIN_LEVEL = 70;

/** Why a start attempt was refused. */
export type GuildQuestStartFailure =
  | 'no-guild'
  | 'not-master'
  | 'level'
  | 'already-questing'
  | 'no-prop'
  | 'spawn-failed';

export type GuildQuestStartResult =
  | { readonly ok: true; readonly questId: number; readonly bossObjid: number }
  | { readonly ok: false; readonly reason: GuildQuestStartFailure };

/**
 * Monster spawn/despawn seam -- structurally satisfied by `SpawnManager`
 * (`@flyff/world-core`). An interface so `@flyff/guild` keeps no edge to the
 * spawn layer, matching how `GuildWarService` takes its manager ports.
 */
export interface GuildQuestSpawnPort {
  /** `CreateObj(OT_MOVER, dwWormon)` + `ADDOBJ` (`ScriptLib.cpp:459-474`). */
  spawnMonster(
    moverId: number, pos: { x: number; y: number; z: number }, zoneId: number,
    activeAttack?: boolean,
  ): { readonly m_idMover: number } | undefined;
  /** `pWormon->Delete()` (`guildquest.cpp:57`). */
  kill(id: number, opts?: { despawn?: boolean }): boolean;
}

/**
 * Teleport seam -- the two ejection paths and the entry drop.
 *
 * Same-world only, because the arena is a Madrigal rect and every member being
 * moved is already in Madrigal, so `SETPOS` is correct (see memory
 * `same-world-teleport-setpos-not-replace`).
 */
export interface GuildQuestTeleportPort {
  /** Move a player and refresh their vicinity. */
  teleport(player: CPlayer, pos: { x: number; y: number; z: number }): void;
  /** The zone's revival point -- `GetNearRevivalPos` (`guild.cpp:1000`). */
  revivalPos(player: CPlayer): { x: number; y: number; z: number } | undefined;
}

export interface GuildQuestServiceDeps {
  playerManager: PlayerManager;
  guildManager: GuildManager;
  processor: GuildQuestProcessor;
  spawn: GuildQuestSpawnPort;
  teleport: GuildQuestTeleportPort;
  /**
   * `g_eLocal.GetState( EVE_WORMON )` -- the runtime event flag, config-backed
   * (`world.guildQuestEnabled`, default false = vanilla). A closure so a GM
   * command can flip it without recomposing, matching `isWarEnabled`.
   */
  isQuestEnabled: () => boolean;
  /** Clock seam for tests. */
  now?: () => number;
}

export class GuildQuestService {
  private readonly now: () => number;

  constructor(private readonly deps: GuildQuestServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * `MonHuntStart( nQuest, nState, nState2, n )` -- `ScriptLib.cpp:443-492`.
   *
   * Order of gates follows the C++ where they overlap, with the two added ones
   * (master, level) placed before the expensive work. `nState` is written to the
   * ledger at start, `nState2` becomes the arena's success state (`ns`) and `n`
   * its failure state (`nf`); the shipped dialog passes
   * `(QUEST_WARMON_LV1, QS_BEGIN, QS_END, 1)`.
   */
  start(player: CPlayer, questId: number, state: number, ns: number, nf: number): GuildQuestStartResult {
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return fail('no-guild');
    // divergence 2: neither check exists in `MonHuntStart`.
    if (guild.masterId !== player.m_idPlayer) return fail('not-master');
    if (player.m_nLevel < GUILD_QUEST_MIN_LEVEL) return fail('level');
    // `IsQuesting` first in C++ (`:446`) -- world-exclusive per quest id.
    if (this.deps.processor.isQuesting(questId)) return fail('already-questing');
    const prop = this.deps.processor.getProp(questId);
    if (!prop) return fail('no-prop');

    const boss = this.deps.spawn.spawnMonster(prop.wormonId, prop.pos, player.m_nZoneId, true);
    if (!boss) return fail('spawn-failed');

    // C++ writes the ledger BEFORE opening the arena (`:475-479`), and picks
    // Insert vs Update on `nState == QS_BEGIN`. Both land on the same row, so
    // the upsert behind `setQuest` covers each.
    this.setQuestState(guild, questId, state);
    const elem = this.deps.processor.open(questId, state, ns, nf, guild.id, boss.m_idMover);
    if (!elem) {
      this.deps.spawn.kill(boss.m_idMover, { despawn: true });
      return fail('no-prop');
    }

    this.pullGuildIn(guild, prop.pos, prop.rect);
    logger.info(
      { questId, guildId: guild.id, masterId: player.m_idPlayer, bossObjid: boss.m_idMover },
      'guild quest arena started',
    );
    return { ok: true, questId, bossObjid: boss.m_idMover };
  }

  /**
   * The boss died -- `CMover::DropItem`'s guild arm (`Mover.cpp:7493-7511`).
   *
   * Call with the dying mover's objid; a mover that is not a live arena's boss
   * is ignored, which is the `pElem->objidWormon == GetId()` test at `:7497`.
   *
   * @param bossObjid - The dead mover's objid.
   * @returns true when this was a quest boss and the arena advanced.
   */
  onBossKilled(bossObjid: number): boolean {
    const elem = this.deps.processor.all().find(
      (e) => e.bossObjid === bossObjid && e.process === GQP_WORMON,
    );
    if (!elem) return false;

    // divergence 1: C++ credits `pAttacker->GetGuild()` with no check that it is
    // the guild that opened the arena, so any guild can steal the completion and
    // a guildless killer voids it.
    const guild = this.deps.guildManager.get(elem.guildId);
    if (guild) this.setQuestState(guild, elem.questId, elem.ns);
    this.deps.processor.toGetItem(elem);
    logger.info({ questId: elem.questId, guildId: elem.guildId }, 'guild quest boss killed');
    return true;
  }

  /**
   * The arena tick -- `CGuildQuestProcessor::Process` (`guildquest.cpp:21-174`).
   *
   * Two branches per arena, mirroring the C++ `if( dwEndTime < dwTickCount )`
   * split:
   *
   * - **Deadline passed.** `GQP_WORMON` writes the FAILURE state (`nf`) to the
   *   ledger, deletes the boss, and closes. `GQP_GETITEM` just ejects and
   *   closes -- the success state was already written when the boss died.
   * - **Still running.** Scan the rect: `GQP_WORMON` closes early once no LIVE
   *   member remains inside (a wipe, `:115`), `GQP_GETITEM` closes once no
   *   member remains inside at all -- alive or not (`:158`, which omits the
   *   `IsLive()` term the wipe check has). Both are behind the ten-tick
   *   debounce, which C++ applies to the `GQP_WORMON` arm ONLY (`:88`); the
   *   `GQP_GETITEM` arm scans from its first tick.
   */
  tick(): void {
    if (!this.deps.isQuestEnabled()) return;
    const nowMs = this.now();
    for (const elem of this.deps.processor.all()) {
      const rect = this.deps.processor.rectOf(elem.questId);
      if (!rect) continue;
      if (this.deps.processor.isExpired(elem, nowMs)) {
        this.onDeadline(elem, rect);
      } else {
        this.onRunning(elem, rect);
      }
    }
  }

  /** `pElem->dwEndTime < dwTickCount` -- the timeout arm (`:37-79`). */
  private onDeadline(elem: GuildQuestElem, rect: QuestRect): void {
    const guild = this.deps.guildManager.get(elem.guildId);
    if (elem.process === GQP_WORMON) {
      // `nf` -- the failure state (`:50`).
      if (guild) this.setQuestState(guild, elem.questId, elem.nf);
      if (elem.bossObjid !== undefined) this.deps.spawn.kill(elem.bossObjid, { despawn: true });
    }
    if (guild) this.ejectFromRect(guild, rect);
    this.deps.processor.close(elem.questId);
  }

  /** The still-running arm (`:82-170`). */
  private onRunning(elem: GuildQuestElem, rect: QuestRect): void {
    const guild = this.deps.guildManager.get(elem.guildId);
    if (elem.process === GQP_WORMON) {
      // Debounce is on this arm only (`:88`).
      if (!this.deps.processor.bumpScan(elem)) return;
      if (guild && this.hasMemberInRect(guild, rect, true)) return;
      // A wipe: failure state, boss removed, arena closed (`:115-128`).
      if (guild) {
        this.setQuestState(guild, elem.questId, elem.nf);
        this.ejectFromRect(guild, rect);
      }
      if (elem.bossObjid !== undefined) this.deps.spawn.kill(elem.bossObjid, { despawn: true });
      this.deps.processor.close(elem.questId);
      return;
    }
    if (elem.process !== GQP_GETITEM) return;
    // Loot window: no `IsLive()` term -- a corpse in the rect keeps it open
    // (`:149`).
    if (guild && this.hasMemberInRect(guild, rect, false)) return;
    if (guild) this.ejectFromRect(guild, rect);
    this.deps.processor.close(elem.questId);
  }

  /**
   * `TextCmd_SetGuildQuest` / `sgq` (`FuncTextCmd.cpp:1257-1286`) -- write one
   * ledger entry for a guild addressed BY NAME.
   *
   * Deliberately does not touch the arena: the C++ command calls
   * `pGuild->SetQuest` + `SendUpdateGuildQuest` and stops, so it spawns no boss,
   * starts no timer, and does not mark the quest id as occupied. An admin using
   * it to set state 14 is editing the ledger, not completing a run.
   *
   * The caller has already validated the state range.
   *
   * @returns false when no guild by that name exists.
   */
  setStateByGuildName(guildName: string, questId: number, state: number): boolean {
    const guild = this.deps.guildManager.getByName(guildName);
    if (!guild) return false;
    this.setQuestState(guild, questId, state);
    logger.info({ guildName, questId, state }, 'guild quest state set by admin command');
    return true;
  }

  /**
   * `prj.IsGuildQuestRegion( vPos )` (`Project.cpp:4635`) -- is this point in
   * ANY quest rect?
   *
   * A PROP-table scan, so it suppresses regardless of whether a quest is live.
   * The eight C++ call sites gate blink, friend/party summon, the return
   * scroll, couple warp, and `IsTeleportable`; exposed here so whichever of
   * those exist can consult it. Callers that have a world id should pass it --
   * the rect is Madrigal-only and the C++ sites all pair the check with
   * `dwWorld == WI_WORLD_MADRIGAL`.
   */
  isQuestRegion(pos: { x: number; z: number }, worldId?: number): boolean {
    return this.deps.processor.isQuestRegion(pos, worldId);
  }

  /**
   * `CUser::AdjustGuildQuest` (`User.cpp:3652-3690`) -- called when a player
   * enters a world (or is about to be placed) to keep non-owning guilds out of
   * an occupied arena.
   *
   * Ejects when the point is in a quest rect AND either no arena is live there
   * or the live one belongs to a different guild (`:3659`). A member of the
   * owning guild is left alone.
   *
   * @returns true when the player was moved.
   */
  adjustOnEnter(player: CPlayer): boolean {
    const questId = this.deps.processor.rectAt(player.m_vPos);
    if (questId === undefined) return false;
    const elem = this.deps.processor.get(questId);
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (elem && guild && elem.guildId === guild.id) return false;
    return this.ejectPlayer(player);
  }

  /**
   * `MonHuntStart`'s tail (`ScriptLib.cpp:482-483`) -- pull the guild to the
   * arena.
   *
   * The drop point is NOT the boss position: `z` is
   * `((vPos.z * 2) + prop.y2) / 3`, i.e. pulled a third of the way toward the
   * rect's far edge, so the party lands off the boss rather than on it. C++
   * passes `bMasterAround = TRUE`, moving only members near the master
   * (`CGuild::Replace`, `guild.cpp:1012-1040`), and unequips rides on arrival
   * (`:1035`).
   *
   * ponytail: `bMasterAround` proximity filter and the ride unequip are not
   * ported -- every online member is pulled. Both need seams this service does
   * not have (a distance query and the ride state), and the arena is
   * master-started so the roster is expected to be gathered already.
   */
  private pullGuildIn(
    guild: Guild, bossPos: { x: number; y: number; z: number }, rect: QuestRect,
  ): void {
    // `prop.y2` is the file's SECOND y, which after the swap is `rect.top`.
    const dropZ = (bossPos.z * 2 + rect.top) / 3;
    const dest = { x: bossPos.x, y: bossPos.y, z: dropZ };
    for (const member of guild.members) {
      const player = this.deps.playerManager.get(member.characterId);
      if (player) this.deps.teleport.teleport(player, dest);
    }
  }

  /**
   * `CGuild::ReplaceLodestar( rect )` (`guild.cpp:982-1010`) -- eject every
   * member currently inside the rect to a revival point.
   *
   * Only members physically inside are moved, and unlike `AdjustGuildQuest`
   * this path does not branch on chaotic state.
   */
  private ejectFromRect(guild: Guild, rect: QuestRect): void {
    for (const member of guild.members) {
      const player = this.deps.playerManager.get(member.characterId);
      if (!player) continue;
      if (!inRect(rect, player.m_vPos)) continue;
      this.ejectPlayer(player);
    }
  }

  private ejectPlayer(player: CPlayer): boolean {
    const pos = this.deps.teleport.revivalPos(player);
    if (!pos) return false;
    this.deps.teleport.teleport(player, pos);
    return true;
  }

  /**
   * Is any member of this guild standing in the rect?
   *
   * @param requireLive - true adds the `IsLive()` term the wipe check has
   *   (`guildquest.cpp:106`) and the loot-window check omits (`:149`).
   */
  private hasMemberInRect(guild: Guild, rect: QuestRect, requireLive: boolean): boolean {
    for (const member of guild.members) {
      const player = this.deps.playerManager.get(member.characterId);
      if (!player) continue;
      if (!inRect(rect, player.m_vPos)) continue;
      if (requireLive && player.m_bDead) continue;
      return true;
    }
    return false;
  }

  /**
   * Write one ledger entry and notify online members --
   * `CGuild::SetQuest` (`guild.cpp:909-944`) plus its
   * `SNAPSHOTTYPE_SETGUILDQUEST` fan-out (`:930-943`).
   *
   * The `QS_BEGIN` reference keeps the Insert-vs-Update split visible even
   * though our upsert makes it moot (`ScriptLib.cpp:476-479`).
   */
  private setQuestState(guild: Guild, questId: number, state: number): void {
    const isFirst = state === QS_BEGIN && this.deps.guildManager.getQuest(guild.id, questId) === undefined;
    if (!this.deps.guildManager.setQuest(guild.id, questId, state)) return;
    for (const member of guild.members) {
      const player = this.deps.playerManager.get(member.characterId);
      if (!player) continue;
      this.deps.playerManager.sendTo(player, buildSetGuildQuest(player.m_idPlayer, questId, state));
    }
    logger.debug({ guildId: guild.id, questId, state, isFirst }, 'guild quest state written');
  }
}

function fail(reason: GuildQuestStartFailure): GuildQuestStartResult {
  return { ok: false, reason };
}

/** `CRect::PtInRect` on x/z -- see `ptInRect` in the manager. */
function inRect(r: QuestRect, pos: { x: number; z: number }): boolean {
  return pos.x >= r.left && pos.x < r.right && pos.z >= r.top && pos.z < r.bottom;
}
