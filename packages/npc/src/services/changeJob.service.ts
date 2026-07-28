/**
 * Job-change service interface -- the dialog `ChangeJob(n)` sink target.
 *
 * The NPC dialog interpreter calls {@link changeJob} when a `source:` body runs
 * `ChangeJob(nJob)` (e.g. the 8 `mada_*` job masters). The implementation lives
 * in `@flyff/world-server` (`ChangeJobServiceImpl`) -- it validates the level
 * gate (Vagrant must be exactly level 15, matching C++ `DPSrvr.cpp:4699`),
 * sets `m_nJob`, re-seeds the skill roster, persists the class, and emits the
 * SET_JOB_SKILL / SET_NEAR_JOB_SKILL snapshots.
 *
 * Defined here (in `@flyff/npc`) so the dialog service depends on the interface,
 * not the world-server implementation -- keeping `@flyff/npc` free of the
 * world-server's DB/socket wiring.
 *
 * @module services/changeJob
 */

import type { CPlayer } from '@flyff/entities';

export interface ChangeJobService {
  /** Apply a job change to `player` for `targetJob`. Validates + emits packets. */
  changeJob(player: CPlayer, targetJob: number): void;
}
