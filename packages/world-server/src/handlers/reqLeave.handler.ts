/**
 * REQ_LEAVE handler -- `PACKETTYPE_REQ_LEAVE` (0x00ff00fa).
 *
 * `CDPSrvr::OnReqLeave` (`WORLDSERVER/DPSrvr.cpp:6703`) reads no body and, if
 * `m_dwLeavePenatyTime == 0`, sets it to `timeGetTime() + TIMEWAIT_CLOSE*1000`
 * (`_Common/DefineCommon.h:19` -- TIMEWAIT_CLOSE = 10s). Idempotent -- repeat
 * sends do not extend the deadline. The client emits this on logout initiation
 * (exit / character select); the server-side teardown itself fires later via
 * LEAVE / ScheduleDestroy, gated by the safe-zone / guild-war penalty path
 * (`CUserMng::RemoveUserFromCacheMsg`, User.cpp:3880).
 *
 * We only record the deadline here; the existing LEAVE handler performs the
 * actual disconnect. ponytail: no penalty enforcement yet -- LEAVE destroys
 * immediately. When porting the penalty, consult this field in the LEAVE path.
 *
 * @module handlers/reqLeave
 */

import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import type { PlayerManager } from '@flyff/world-core';

/** TIMEWAIT_CLOSE (10s) -- `_Common/DefineCommon.h:19`. */
const TIMEWAIT_CLOSE_MS = 10_000;

export class ReqLeaveHandler {
  constructor(private readonly playerManager: PlayerManager) {}

  handleReqLeave(socket: ClientSocket): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) {
      socket.destroy();
      return;
    }
    if (player.m_dwLeavePenatyTime === 0) {
      player.m_dwLeavePenatyTime = Date.now() + TIMEWAIT_CLOSE_MS;
    }
  }
}
