/**
 * ENDSKILLQUEUE handler -- `PACKETTYPE_ENDSKILLQUEUE` (0x00ff00d5).
 *
 * `DPSrvr::OnEndSkillQueue` (`WORLDSERVER/DPSrvr.cpp:7077`) reads no body and
 * calls `CUserTaskBar::OnEndSkillQueue(pUser)` (`_Interface/UserTaskBar.cpp:195`),
 * which writes a single self-only snapshot: `AddHdr(GETID(pUser),
 * SNAPSHOTTYPE_ENDSKILLQUEUE)` -- no payload. The client's `OnEndSkillQueue`
 * (`Neuz/DPClient.cpp:15646`) calls `CWndTaskBar::OnCancelSkill()`, clearing the
 * queued skill slot in the F1-F9 grid.
 *
 * Pure ack -- no state, no service. The client emits this on cast cancel /
 * queue exhaustion; we just echo back so its taskbar UI settles.
 *
 * @module handlers/endSkillQueue.handler
 */

import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { sendPacket } from '@flyff/core/net/dispatcher';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SessionState } from '@flyff/core/constants/sessionState';
import { NULL_ID, SNAPSHOTTYPE_ENDSKILLQUEUE } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';

export class EndSkillQueueHandler {
  constructor(private readonly playerManager: PlayerManager) {}

  handleEndSkillQueue(socket: ClientSocket): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(player.m_idPlayer);
    w.writeWord(SNAPSHOTTYPE_ENDSKILLQUEUE);
    sendPacket(socket, w.build());
  }
}
