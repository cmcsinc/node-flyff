/**
 * ChangeJobService -- server-side job-change handler (`ChangeJob(n)` dialog sink).
 *
 * Ports `DPSrvr.cpp:4685-4721` (the `PACKETTYPE_SEND_TO_SERVER_CHANGEJOB` path
 * driven by NPC dialog scripts) + `CMover::AddChangeJob`
 * (`_Common/MoverParam.cpp:1727`). The 8 `mada_*` job masters run a `source:`
 * body like:
 *   if (GetQuestState(QUEST_HEROKNI_TRN4) == QS_END && GetPlayerJob() == 1
 *       && GetPlayerLvl() == 60) { ChangeJob( 6 ); } else { Exit(); }
 * -- the job gating runs in the dialog itself; this service is the authoritative
 * server-side validation + state mutation for the `ChangeJob(n)` call.
 *
 * Validation (C++ `DPSrvr.cpp:4697`): a Vagrant (`JOB_VAGRANT`, `IsBaseJob`)
 * must be EXACTLY level 15 (`MAX_JOB_LEVEL`) to change to a 1st/2nd job. The
 * target must be in the expert (1-5) or professional (6-15) range -- mirrors
 * `AddChangeJob`'s two accepted blocks (`MoverParam.cpp:1731/1745`).
 *
 * On success: set `m_nJob`, re-seed the skill roster for the new job (C++
 * `AddChangeJob` fills the next tier's slots from `prj.m_aJobSkill[nJob]`),
 * WAL-journal the transition (idempotent replay), emit SET_JOB_SKILL (self) +
 * SET_NEAR_JOB_SKILL (vicinity), and persist fire-and-forget.
 *
 * @module services/changeJob
 */

import type { CPlayer } from '@flyff/entities';
import type { ChangeJobService } from '@flyff/npc';
import type { CharacterRepository, Journal } from '@flyff/database';
import type { SkillIndex } from '@flyff/resources';
import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import {
  SetJobSkillSerializer, SetNearJobSkillSerializer, VISIBILITY_RADIUS,
} from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';
import { rosterIdsForJob } from './join.service';

const logger = createLogger({ module: 'changeJob-service' });

/** `defineJob.h:75` -- JOB_VAGRANT (JTYPE_BASE), the only job that can change. */
const JOB_VAGRANT = 0;

/** `defineJob.h` job-id bounds. `MAX_JOBBASE(1) <= nJob` and `nJob < MAX_PROFESSIONAL(16)`. */
const MIN_JOB_CHANGE = 1;
const MAX_JOB_CHANGE = 15;

export interface ChangeJobServiceDeps {
  charRepo: Pick<CharacterRepository, 'updateClass' | 'updateSkillPoints'>;
  /** Skill index for re-seeding the new job's roster IDs (C++ `prj.m_aJobSkill`). */
  skills: SkillIndex;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  /** Optional WAL journal -- crash-recovery backup for the fire-and-forget persist. */
  journal?: Journal;
  /** Stat reset for the `InitStat()` dialog call that follows `ChangeJob(n)`. */
  statService?: { initStat(player: CPlayer): void };
}

export class ChangeJobServiceImpl implements ChangeJobService {
  private readonly setJobSkill = new SetJobSkillSerializer();
  private readonly setNearJobSkill = new SetNearJobSkillSerializer();

  constructor(private readonly deps: ChangeJobServiceDeps) {}

  changeJob(player: CPlayer, targetJob: number): void {
    // 1. C++ `DPSrvr.cpp:4697`: only a Vagrant (IsBaseJob) can change job here.
    if (player.m_nJob !== JOB_VAGRANT) {
      logger.debug({ charId: player.m_idPlayer, job: player.m_nJob }, 'changeJob rejected: not a vagrant');
      return;
    }
    // 2. C++ `DPSrvr.cpp:4699`: Vagrant must be EXACTLY level 15 (MAX_JOB_LEVEL).
    //    Lower = TID_GAME_CHGJOBLEVEL15 ("need level 15"); higher is unreachable
    //    because the job cap (Fix 1) blocks exp past 15.
    if (player.m_nLevel !== 15) {
      logger.debug({ charId: player.m_idPlayer, level: player.m_nLevel }, 'changeJob rejected: not level 15');
      return;
    }
    // 3. C++ `AddChangeJob` (MoverParam.cpp:1731/1745): expert (1-5) or pro (6-15).
    if (targetJob < MIN_JOB_CHANGE || targetJob > MAX_JOB_CHANGE) {
      logger.debug({ charId: player.m_idPlayer, targetJob }, 'changeJob rejected: out-of-range job');
      return;
    }

    // 4. C++ `AddChangeJob` body: set m_nJob + re-seed the skill roster.
    player.m_nJob = targetJob;
    player._dirty.add('m_nJob');
    player.seedRoster(rosterIdsForJob(this.deps.skills, targetJob));
    player._dirty.add('m_aJobSkill');

    // 5. WAL journal the ABSOLUTE post-state (idempotent replay) before the
    //    fire-and-forget persist -- rule 04. Persists both the class and the
    //    re-seeded roster (AddChangeJob re-derives m_aJobSkill for the new job).
    const roster = player.m_aJobSkill.map((s, slot) => ({ slot, skillId: s.skillId, level: s.level }));
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_JOB',
      payload: { class: targetJob, roster },
    });

    // 6. SET_JOB_SKILL (0x00a7) -> self. Client rebuilds its skill window from
    //    the new roster + job (C++ `AddSetChangeJob`, User.cpp:1157).
    this.deps.playerManager.sendTo(
      player,
      this.setJobSkill.build(player.m_idPlayer, targetJob, player.m_aJobSkill),
    );
    // 7. SET_NEAR_JOB_SKILL (0x00a8) -> vicinity, skips self (C++
    //    `AddNearSetChangeJob`, User.cpp:5107). Peers refresh the mover's job.
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.setNearJobSkill.build(player.m_idPlayer, targetJob),
      player,
    );

    // 8. Persist fire-and-forget (rule 02: service calls repo, no SQL). The WAL
    //    row above is the crash-recovery backup. C++ `AddChangeJob` ends with
    //    `g_dpDBClient.SaveSkill` (persists roster); class persists on the
    //    character row's `class` column.
    this.deps.charRepo.updateClass(player.m_idPlayer, targetJob).catch((err: unknown) =>
      logger.error({ err, charId: player.m_idPlayer }, 'changeJob class persist failed'),
    );
  }

  /**
   * `InitStat()` -- delegates to StatService (C++ `ScriptLib.cpp:570`). Lives on
   * this service because the dialog sink already holds a `ChangeJobService`
   * reference and the two calls always run as a pair in the job-master bodies.
   */
  initStat(player: CPlayer): void {
    this.deps.statService?.initStat(player);
  }
}
