/**
 * MotionService — `PACKETTYPE_MOTION` (0x00ff0016).
 *
 * `DPSrvr::OnMotion` (DPSrvr.cpp:4827) reads `DWORD dwMsg` and calls
 * `pUser->SendActMsg((OBJMSG)dwMsg)`. On success it clears destination/angle
 * state and echoes via `g_UserMng.AddMotion(pUser, dwMsg)`. On failure it
 * replies `AddMotionError` (a defined-text error code).
 *
 * We do not model `SendActMsg`'s state machine yet (no ActMover). All MOTION
 * packets are broadcast verbatim. ponytail: validate `dwMsg` against the
 * `OBJMSG_*` enum once `objmsg.ts` lands; reject invalid with motion error.
 *
 * No WAL (rule 04 — not in the journal list).
 *
 * @module services/motion.service
 */

import type { ZoneManager } from '../managers/zone.manager.js';
import type { CPlayer } from '../entities/player.js';
import { MotionSerializer } from '../net/snapshot/motion.serializer.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';

export interface MotionServiceDeps {
  zoneManager: ZoneManager;
}

export type MotionOutcome = { ok: true; reached: number };

export class MotionService {
  private readonly serializer = new MotionSerializer();
  constructor(private readonly deps: MotionServiceDeps) {}

  /** Broadcast a motion frame (stand/sit/etc.) from `player` to zone peers. */
  motion(player: CPlayer, dwMsg: number): MotionOutcome {
    const packet = this.serializer.build(player.m_idPlayer, dwMsg);
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet,
    );
    return { ok: true, reached };
  }
}
