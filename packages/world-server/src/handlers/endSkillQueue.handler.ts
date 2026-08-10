/**
 * ENDSKILLQUEUE handler -- `PACKETTYPE_ENDSKILLQUEUE` (0x00ff00d5).
 *
 * `DPSrvr::OnEndSkillQueue` (`WORLDSERVER/DPSrvr.cpp:7077`) reads no body and
 * calls `CUserTaskBar::OnEndSkillQueue(pUser)` (`_Interface/UserTaskBar.cpp:195`),
 * which clears `m_nUsedSkillQueue = -1` and writes a single self-only snapshot
 * `AddHdr(GETID(pUser), SNAPSHOTTYPE_ENDSKILLQUEUE)` -- no payload. The client's
 * `OnEndSkillQueue` (`Neuz/DPClient.cpp:15646`) calls `CWndTaskBar::OnCancelSkill()`,
 * clearing the queued skill slot in the F1-F9 grid.
 *
 * The client emits this on cast cancel / movement / queue exhaustion. We reset
 * the server-side queue pointer (so a stray resolved cast stops advancing) and
 * echo the ack so its taskbar UI settles.
 *
 * @module handlers/endSkillQueue
 */

import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { sendPacket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { buildEndSkillQueue } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';

export class EndSkillQueueHandler {
  constructor(private readonly playerManager: PlayerManager) {}

  handleEndSkillQueue(socket: ClientSocket): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return; }

    if (player.m_queueTimer !== undefined) {
      clearTimeout(player.m_queueTimer);
      player.m_queueTimer = undefined;
    }
    player.m_nUsedSkillQueue = -1;
    sendPacket(socket, buildEndSkillQueue(player.m_idPlayer));
  }
}
