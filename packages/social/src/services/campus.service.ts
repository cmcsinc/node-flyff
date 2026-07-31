/**
 * CampusService -- the `CCampusHelper` master/pupil mentoring system.
 *
 * C++ files: `WORLDSERVER/CampusHelper.cpp` (gates + rules),
 * `_Common/Campus.cpp` (CCampus/CCampusMember), `WORLDSERVER/DPSrvr.cpp:12389+`
 * (the 4 client opcodes), `WORLDSERVER/User.cpp:8810-8851` (snapshots).
 *
 * ## Tier collapse
 *
 * C++ is a 3-tier flow: client -> world -> DB server -> broadcast to all worlds.
 * The world server performs **zero** local mutation -- `OnAcceptCampusMember`
 * only calls `g_dpDBClient.SendAddCampusMember(...)` and waits for
 * `PACKETTYPE_CAMPUS_ADD_MEMBER` to come back before anything exists. A
 * single-process emulator collapses tiers 2-3, so this service writes to the DB
 * and then does what the broadcast handler would have done. The ordering is
 * preserved (persist, then notify) so the observable sequence matches.
 *
 * ## Gate order (`IsInviteAble`, CampusHelper.cpp:240) -- all errors to the REQUESTER
 *
 *   1. requester's campus points < 0        -> TID_GAME_TS_WANTMYTSP
 *   2. target's campus points < 0           -> TID_GAME_TS_WANTYOURTSP
 *   3a. master invites pupil: master finished the campus quest, master's campus
 *       has a free pupil slot, target not already in a campus
 *   3b. pupil invites master: requester not in a campus, TARGET finished the
 *       quest, target's campus has a free slot
 *   4. neither role matches                 -> TID_GAME_TS_NOTLEVEL
 *
 * `IsMasterLevel` is a LEVEL test (>= 91); `IsPupilLevel` is a JOB test
 * (`GetJob() < MAX_EXPERT`, i.e. < 15). They are independent -- a level-91
 * first-job character satisfies both.
 *
 * ## Client-side gate that makes this look broken when it is not
 *
 * `OnInviteCampusMember` (`Neuz/DPClient.cpp:19190`) drops the invite silently
 * unless the requester is already in the client's `CPlayerDataCenter` cache. An
 * invite from someone the invitee has never seen renders nothing. Noted on
 * {@link buildCampusInvite}.
 *
 * No WAL: campus points are not in the rule-04 journal list, and every mutation
 * is written through immediately.
 *
 * @module social/services/campus
 */

import type { CampusRepository, CharacterRepository } from '@flyff/database';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import {
  CAMPUS_MASTER, CAMPUS_PUPIL, MAX_PUPIL_NUM, MIN_LV2_POINT, MIN_LV3_POINT,
  COMPLETE_PUPIL_LEVEL, MIN_MASTER_LEVEL, REMOVE_CAMPUS_POINT, MAX_EXPERT,
  CAMPUS_RECOVERY_TIME_MS, CAMPUS_RECOVERY_POINT, CAMPUS_REQUIRED_QUESTS,
  CAMPUS_BUFF_BY_LEVEL, CAMPUS_REWARDS,
  TID_GAME_TS_NOTQUEST, TID_GAME_TS_FULLSTUDENT, TID_GAME_TS_NOTLEVEL,
  TID_GAME_TS_ALREADY, TID_GAME_TS_REFUSAL,
  TID_GAME_TS_WANTMYTSP, TID_GAME_TS_WANTYOURTSP,
} from '../constants/campus';
import {
  buildCampusInvite, buildCampusUpdate, buildCampusRemove, buildCampusUpdatePoint,
  type CampusMemberFrame,
} from '../net/snapshot/campus.serializer';

const logger = createLogger({ module: 'campus-service' });

/** In-memory campus, mirroring `CCampus` (`CCampusMng::m_mapCampus`). */
interface LiveCampus {
  readonly id: number;
  masterId: number;
  /** charId -> `CAMPUS_MASTER` | `CAMPUS_PUPIL`. */
  readonly members: Map<number, number>;
  /** `CCampus::m_nPreBuffLevel` -- latch for the master's buff-level change. */
  preBuffLevel: number;
}

export interface CampusServiceDeps {
  playerManager: PlayerManager;
  campusRepo: CampusRepository;
  charRepo: Pick<CharacterRepository, 'findById'>;
  /** `pUser->IsCompleteQuest(id)`. Absent => treat the quest gate as unmet. */
  isQuestComplete?: (player: CPlayer, questId: number) => boolean;
  /** Applies / removes the `IK3_TS_BUFF` campus buff item. */
  applyCampusBuff?: (player: CPlayer, itemId: number) => void;
  removeCampusBuff?: (player: CPlayer) => void;
  /** Emits a `TID_*` notice with printf args (DEFINEDTEXT). */
  sendDefinedText?: (player: CPlayer, tid: number, args?: string) => void;
}

export type CampusResult =
  | { ok: true }
  | { ok: false; reason: string };

const OK: CampusResult = { ok: true };
const fail = (reason: string): CampusResult => ({ ok: false, reason });

export class CampusService {
  /** campusId -> campus. Hydrated by {@link bootstrap} (`PACKETTYPE_CAMPUS_ALL`). */
  private readonly campuses = new Map<number, LiveCampus>();
  /** charId -> campusId (`CCampusMng::m_mapPid2Cid`). */
  private readonly byCharacter = new Map<number, number>();
  /** Live campus points per online character (`m_nCampusPoint`). */
  private readonly points = new Map<number, number>();
  /** Recovery cursor per online character (`m_dwTickCampus`; 0 = not started). */
  private readonly ticks = new Map<number, number>();

  constructor(private readonly deps: CampusServiceDeps) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Boot-time load, equivalent to the DB server pushing
   * `PACKETTYPE_CAMPUS_ALL` -> `CCampusMng::Serialize` into each world.
   */
  async bootstrap(): Promise<void> {
    const all = await this.deps.campusRepo.loadAll();
    for (const c of all) {
      const members = new Map<number, number>();
      for (const m of c.members) members.set(m.characterId, m.memberLevel);
      this.campuses.set(c.id, { id: c.id, masterId: c.masterId, members, preBuffLevel: 0 });
      for (const m of c.members) this.byCharacter.set(m.characterId, c.id);
    }
    logger.info({ campuses: this.campuses.size, members: this.byCharacter.size },
      'campus data loaded');
  }

  /** JOIN -- cache points/tick and push the current campus + point value. */
  async onJoin(player: CPlayer): Promise<void> {
    this.points.set(player.m_idPlayer, await this.deps.campusRepo.getPoints(player.m_idPlayer));
    this.ticks.set(player.m_idPlayer, await this.deps.campusRepo.getTick(player.m_idPlayer));

    this.deps.playerManager.sendTo(player,
      buildCampusUpdatePoint(player.m_idPlayer, this.getPoints(player.m_idPlayer)));

    const campus = this.campusOf(player.m_idPlayer);
    if (campus) {
      this.sendUpdate(player, campus);
      // Our arrival changes every other member's buff level.
      this.refreshBuffs(campus);
    }
  }

  /** Disconnect -- drop caches; peers' buff levels change because we left. */
  onDisconnect(charId: number): void {
    const campus = this.campusOf(charId);
    this.points.delete(charId);
    this.ticks.delete(charId);
    if (campus) this.refreshBuffs(campus);
  }

  // ── Invite / accept / refuse ──────────────────────────────────────────────

  /**
   * `OnInviteCampusMember` (`CampusHelper.cpp:451`) -- pops the invite dialog on
   * the target if `IsInviteAble` passes.
   */
  invite(requester: CPlayer, targetCharId: number): CampusResult {
    const target = this.deps.playerManager.get(targetCharId);
    if (!target) return fail('not-online');
    if (target.m_idPlayer === requester.m_idPlayer) return fail('self');

    const gate = this.isInviteAble(requester, target);
    if (!gate.ok) return gate;

    this.deps.playerManager.sendTo(target,
      buildCampusInvite(target.m_idPlayer, requester.m_idPlayer, requester.m_szName));
    return OK;
  }

  /**
   * `OnAcceptCampusMember` (`CampusHelper.cpp:456`) -- the accept leg. Re-runs
   * `IsInviteAble` (the invite's verdict is NOT trusted) plus the role check,
   * then creates the pairing.
   *
   * `accepter` is the invitee; `requesterId` is who sent the invite.
   */
  async accept(accepter: CPlayer, requesterId: number): Promise<CampusResult> {
    const requester = this.deps.playerManager.get(requesterId);
    if (!requester) return fail('requester-offline');

    // Which side is the master? C++ tries requester-as-master first.
    let master: CPlayer;
    let pupil: CPlayer;
    if (this.isMasterLevel(requester) && this.isPupilLevel(accepter)) {
      master = requester; pupil = accepter;
    } else if (this.isMasterLevel(accepter) && this.isPupilLevel(requester)) {
      master = accepter; pupil = requester;
    } else {
      this.notice(requester, TID_GAME_TS_NOTLEVEL);
      return fail('no-role');
    }

    const gate = this.isInviteAble(requester, accepter);
    if (!gate.ok) return gate;

    const campusId = await this.deps.campusRepo.addMember(
      master.m_idPlayer, pupil.m_idPlayer, CAMPUS_MASTER, CAMPUS_PUPIL,
    );

    let campus = this.campuses.get(campusId);
    if (!campus) {
      campus = { id: campusId, masterId: master.m_idPlayer, members: new Map(), preBuffLevel: 0 };
      this.campuses.set(campusId, campus);
    }
    campus.members.set(master.m_idPlayer, CAMPUS_MASTER);
    campus.members.set(pupil.m_idPlayer, CAMPUS_PUPIL);
    this.byCharacter.set(master.m_idPlayer, campusId);
    this.byCharacter.set(pupil.m_idPlayer, campusId);

    this.broadcastUpdate(campus);
    this.refreshBuffs(campus);
    logger.info({ campusId, master: master.m_idPlayer, pupil: pupil.m_idPlayer },
      'campus member added');
    return OK;
  }

  /** `OnRefuseCampusMember` -- notice back to the requester, nothing else. */
  refuse(refuser: CPlayer, requesterId: number): CampusResult {
    const requester = this.deps.playerManager.get(requesterId);
    if (!requester) return fail('requester-offline');
    this.notice(requester, TID_GAME_TS_REFUSAL);
    return OK;
  }

  // ── Removal ───────────────────────────────────────────────────────────────

  /**
   * `OnRemoveCampusMember` (`CampusHelper.cpp:472`) -- master expels a pupil, or
   * a pupil removes themselves from their master. Any other combination is a
   * no-op. The REQUESTER always forfeits `REMOVE_CAMPUS_POINT` (5), which is what
   * pushes their balance negative and starts the recovery timer.
   *
   * Dissolve rules from the DB-driven handler: removing the MASTER dissolves the
   * whole campus, and so does dropping below 2 members.
   */
  async removeMember(requester: CPlayer, targetCharId: number): Promise<CampusResult> {
    const campus = this.campusOf(requester.m_idPlayer);
    if (!campus) return fail('no-campus');
    if (!campus.members.has(targetCharId)) return fail('not-member');

    const requesterIsMaster = campus.masterId === requester.m_idPlayer;
    const targetIsMaster = campus.masterId === targetCharId;

    // Who actually leaves: a master expelling a pupil removes the pupil; a pupil
    // "removing the master" removes THEMSELVES (CampusHelper.cpp:482).
    let leavingId: number;
    if (requesterIsMaster && !targetIsMaster) leavingId = targetCharId;
    else if (!requesterIsMaster && targetIsMaster) leavingId = requester.m_idPlayer;
    else return fail('bad-pair');

    await this.deps.campusRepo.removeMember(campus.id, leavingId);
    campus.members.delete(leavingId);
    this.byCharacter.delete(leavingId);

    const leaver = this.deps.playerManager.get(leavingId);
    if (leaver) this.deps.playerManager.sendTo(leaver, buildCampusRemove(leavingId, campus.id));

    // Master gone, or fewer than 2 left -> dissolve.
    if (leavingId === campus.masterId || campus.members.size < 2) {
      await this.dissolve(campus);
    } else {
      this.broadcastUpdate(campus);
      this.refreshBuffs(campus);
    }

    // The dissolution penalty lands on the REQUESTER, not the leaver.
    await this.addPoints(requester.m_idPlayer, -REMOVE_CAMPUS_POINT);
    return OK;
  }

  /** Tear the campus down and tell every member (`AddAllMemberRemoveCampus`). */
  private async dissolve(campus: LiveCampus): Promise<void> {
    for (const charId of campus.members.keys()) {
      this.byCharacter.delete(charId);
      const p = this.deps.playerManager.get(charId);
      if (p) {
        this.deps.playerManager.sendTo(p, buildCampusRemove(charId, campus.id));
        this.deps.removeCampusBuff?.(p);
      }
    }
    campus.members.clear();
    this.campuses.delete(campus.id);
    await this.deps.campusRepo.dissolve(campus.id);
    logger.info({ campusId: campus.id }, 'campus dissolved');
  }

  // ── Points ────────────────────────────────────────────────────────────────

  /**
   * `RecoveryCampusPoint` (`CampusHelper.cpp:405`) -- regenerates ONLY while the
   * balance is negative. The first call after going negative just starts the
   * timer (C++ `GetCampusTick() == NULL_ID` branch); the grant happens a full
   * interval later.
   */
  async recoverPoints(player: CPlayer, now = Date.now()): Promise<void> {
    if (this.getPoints(player.m_idPlayer) >= 0) return;

    const tick = this.ticks.get(player.m_idPlayer) ?? 0;
    if (tick === 0) {
      this.ticks.set(player.m_idPlayer, now);
      await this.deps.campusRepo.setTick(player.m_idPlayer, now);
      return;
    }
    if (now <= tick + CAMPUS_RECOVERY_TIME_MS) return;

    this.ticks.set(player.m_idPlayer, now);
    await this.deps.campusRepo.setTick(player.m_idPlayer, now);
    await this.addPoints(player.m_idPlayer, CAMPUS_RECOVERY_POINT);
  }

  /**
   * `SetLevelUpReward` (`CampusHelper.cpp:418`) -- a PUPIL levelling up pays both
   * sides. Rewards match on EXACT level, so a multi-level jump skips them.
   * Reaching `COMPLETE_PUPIL_LEVEL` (75) graduates the pupil, dissolving the
   * pairing.
   */
  async onLevelUp(player: CPlayer): Promise<void> {
    const campus = this.campusOf(player.m_idPlayer);
    if (!campus) return;
    if (campus.masterId === player.m_idPlayer) return;      // masters get nothing

    const reward = CAMPUS_REWARDS[player.m_nLevel];
    if (reward) {
      await this.addPoints(campus.masterId, reward.master);
      await this.addPoints(player.m_idPlayer, reward.pupil);
    }
    if (player.m_nLevel === COMPLETE_PUPIL_LEVEL) {
      await this.deps.campusRepo.removeMember(campus.id, player.m_idPlayer);
      campus.members.delete(player.m_idPlayer);
      this.byCharacter.delete(player.m_idPlayer);
      this.deps.playerManager.sendTo(player, buildCampusRemove(player.m_idPlayer, campus.id));
      if (campus.members.size < 2) await this.dissolve(campus);
      else { this.broadcastUpdate(campus); this.refreshBuffs(campus); }
    }
  }

  /** Apply a signed point delta, persist it, and push CAMPUS_UPDATE_POINT. */
  private async addPoints(charId: number, delta: number): Promise<void> {
    const next = await this.deps.campusRepo.addPoints(charId, delta);
    this.points.set(charId, next);
    // Going negative restarts the recovery timer from scratch.
    if (next < 0 && (this.ticks.get(charId) ?? 0) === 0) {
      const now = Date.now();
      this.ticks.set(charId, now);
      await this.deps.campusRepo.setTick(charId, now);
    } else if (next >= 0) {
      this.ticks.set(charId, 0);
      await this.deps.campusRepo.setTick(charId, 0);
    }
    const p = this.deps.playerManager.get(charId);
    if (p) this.deps.playerManager.sendTo(p, buildCampusUpdatePoint(charId, next));
  }

  private getPoints(charId: number): number {
    return this.points.get(charId) ?? 0;
  }

  // ── Buffs ─────────────────────────────────────────────────────────────────

  /**
   * `CUser::ProcessCampus` (`User.cpp:8853`) + `CCampus::GetBuffLevel`
   * (`Campus.cpp:190`). Buff level for a MASTER is the count of currently ONLINE
   * pupils (0-3); for a PUPIL it is 1 if the master is online, else 0. Level 0
   * strips the buff.
   *
   * The master's buff is re-applied whenever the online-pupil count changes
   * (`IsChangeBuffLevel` latches `m_nPreBuffLevel`), because the buff ITEM
   * differs per level.
   */
  private refreshBuffs(campus: LiveCampus): void {
    for (const [charId, memberLevel] of campus.members) {
      const player = this.deps.playerManager.get(charId);
      if (!player) continue;

      const level = this.buffLevel(campus, charId, memberLevel);
      if (level === 0) { this.deps.removeCampusBuff?.(player); continue; }

      if (memberLevel === CAMPUS_MASTER && campus.preBuffLevel !== level) {
        campus.preBuffLevel = level;
        this.deps.removeCampusBuff?.(player);      // level changed -> re-apply
      }
      const itemId = CAMPUS_BUFF_BY_LEVEL[level];
      if (itemId) this.deps.applyCampusBuff?.(player, itemId);
    }
  }

  private buffLevel(campus: LiveCampus, charId: number, memberLevel: number): number {
    if (memberLevel === CAMPUS_MASTER) {
      let online = 0;
      for (const [id, lv] of campus.members) {
        if (lv === CAMPUS_PUPIL && this.deps.playerManager.get(id)) online++;
      }
      return Math.min(MAX_PUPIL_NUM, online);
    }
    return this.deps.playerManager.get(campus.masterId) ? 1 : 0;
  }

  // ── Gates ─────────────────────────────────────────────────────────────────

  /** `IsInviteAble` (`CampusHelper.cpp:240`) -- see the module doc for the order. */
  private isInviteAble(requester: CPlayer, target: CPlayer): CampusResult {
    if (this.getPoints(requester.m_idPlayer) < 0) {
      this.notice(requester, TID_GAME_TS_WANTMYTSP);
      return fail('own-points-negative');
    }
    if (this.getPoints(target.m_idPlayer) < 0) {
      this.notice(requester, TID_GAME_TS_WANTYOURTSP);
      return fail('target-points-negative');
    }

    // Branch A: requester is the master.
    if (this.isMasterLevel(requester) && this.isPupilLevel(target)) {
      return this.checkPair(requester, requester, target);
    }
    // Branch B: requester is the pupil, target is the master.
    if (this.isPupilLevel(requester) && this.isMasterLevel(target)) {
      if (this.campusOf(requester.m_idPlayer)) {
        this.notice(requester, TID_GAME_TS_ALREADY, `"${requester.m_szName}"`);
        return fail('already-in-campus');
      }
      return this.checkPair(requester, target, null);
    }
    this.notice(requester, TID_GAME_TS_NOTLEVEL);
    return fail('no-role');
  }

  /**
   * Shared master-side checks: quest completion and a free pupil slot; plus, when
   * `pupil` is given, that the pupil is not already in a campus.
   * `requester` only receives the notices.
   */
  private checkPair(requester: CPlayer, master: CPlayer, pupil: CPlayer | null): CampusResult {
    if (!this.isCampusQuestComplete(master)) {
      this.notice(requester, TID_GAME_TS_NOTQUEST, `"${master.m_szName}"`);
      return fail('quest-incomplete');
    }
    const campus = this.campusOf(master.m_idPlayer);
    if (campus && this.pupilCount(campus) >= this.maxPupilNum(master)) {
      this.notice(requester, TID_GAME_TS_FULLSTUDENT, `"${master.m_szName}"`);
      return fail('pupils-full');
    }
    if (pupil && this.campusOf(pupil.m_idPlayer)) {
      this.notice(requester, TID_GAME_TS_ALREADY, `"${pupil.m_szName}"`);
      return fail('target-already-in-campus');
    }
    return OK;
  }

  /** `IsMasterLevel` -- a LEVEL test (`GetLevel() >= MIN_MASTER_LEVEL`). */
  private isMasterLevel(player: CPlayer): boolean {
    return player.m_nLevel >= MIN_MASTER_LEVEL;
  }

  /** `IsPupilLevel` -- a JOB test (`GetJob() < MAX_EXPERT`), not a level test. */
  private isPupilLevel(player: CPlayer): boolean {
    return player.m_nJob < MAX_EXPERT;
  }

  /**
   * `GetMaxPupilNum` (`CampusHelper.cpp:337`) -- pupil slots are keyed on CAMPUS
   * POINTS, not level. Negative points give 0 slots.
   */
  private maxPupilNum(player: CPlayer): number {
    const pts = this.getPoints(player.m_idPlayer);
    if (pts < 0) return 0;
    if (pts < MIN_LV2_POINT) return 1;
    if (pts < MIN_LV3_POINT) return 2;
    return MAX_PUPIL_NUM;
  }

  /** `IsCompleteCampusQuest` -- ALL entries of `tCampusQuest` must be complete. */
  private isCampusQuestComplete(player: CPlayer): boolean {
    if (!this.deps.isQuestComplete) return false;
    return CAMPUS_REQUIRED_QUESTS.every((id) => this.deps.isQuestComplete!(player, id));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private campusOf(charId: number): LiveCampus | undefined {
    const id = this.byCharacter.get(charId);
    return id === undefined ? undefined : this.campuses.get(id);
  }

  private pupilCount(campus: LiveCampus): number {
    let n = 0;
    for (const lv of campus.members.values()) if (lv === CAMPUS_PUPIL) n++;
    return n;
  }

  /** `AddAllMemberUpdateCampus` -- one CAMPUS_UPDATE per ONLINE member. */
  private broadcastUpdate(campus: LiveCampus): void {
    for (const charId of campus.members.keys()) {
      const p = this.deps.playerManager.get(charId);
      if (p) this.sendUpdate(p, campus);
    }
  }

  private sendUpdate(player: CPlayer, campus: LiveCampus): void {
    const members: CampusMemberFrame[] = [...campus.members]
      .map(([playerId, memberLevel]) => ({ playerId, memberLevel }));
    this.deps.playerManager.sendTo(player,
      buildCampusUpdate(player.m_idPlayer, campus.id, campus.masterId, members));
  }

  private notice(player: CPlayer, tid: number, args?: string): void {
    this.deps.sendDefinedText?.(player, tid, args);
  }
}
