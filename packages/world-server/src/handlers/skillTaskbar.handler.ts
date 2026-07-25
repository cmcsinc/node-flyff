/**
 * SKILLTASKBAR handler -- `PACKETTYPE_SKILLTASKBAR` (0xffffff0e).
 *
 * `DPSrvr::OnSkillTaskBar` (`WORLDSERVER/DPSrvr.cpp:2141`) reads the action
 * slot upload:
 *
 *   [DWORD nCount]  nCount * { [BYTE nIndex][DWORD dwShortcut][DWORD dwId]
 *                              [DWORD dwType][DWORD dwIndex][DWORD dwUserId]
 *                              [DWORD dwData] }
 *
 * The client (`CDPClient::SendSkillTaskBar`, `Neuz/DPClient.cpp:10834`)
 * always sends all `MAX_SLOT_QUEUE` (5) slots in index order -- it is a full
 * snapshot, not a delta. We replace `player.m_aSlotQueue` wholesale and
 * fire-and-forget persist so the queue survives logout (was the "action slot
 * not persistent" bug: END_SKILLQUEUE cancel was wired but this upload was
 * not, so the queue was never even stored server-side). No ack -- the client
 * manages its own action-slot UI; we only track the queue for persistence
 * and the JOIN repush.
 *
 * @module handlers/skillTaskbar
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import { MAX_SLOT_QUEUE } from '@flyff/world-core';
import type { Shortcut } from '@flyff/entities';
import type { TaskBarService } from '../services/taskbar.service';

const logger = createLogger({ module: 'skilltaskbar-handler' });

export interface SkillTaskBarHandlerDeps {
  playerManager: PlayerManager;
  taskbarService: TaskBarService;
}

export class SkillTaskBarHandler {
  constructor(private readonly deps: SkillTaskBarHandlerDeps) {}

  handleSkillTaskBar(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      const nCount = reader.readDword();
      Validate.dword(nCount);
      if (nCount > MAX_SLOT_QUEUE) {
        logger.warn({ charId: player.m_idPlayer, nCount }, 'SKILLTASKBAR nCount > MAX_SLOT_QUEUE -- dropping');
        return;
      }

      const slots: Shortcut[] = [];
      for (let k = 0; k < nCount; k++) {
        const nIndex = reader.readByte();
        Validate.slot(nIndex, MAX_SLOT_QUEUE);
        const shortcut: Shortcut = {
          dwShortcut: reader.readDword(),
          dwId: reader.readDword(),
          dwType: reader.readDword(),
          dwIndex: reader.readDword(),
          dwUserId: reader.readDword(),
          dwData: reader.readDword(),
        };
        for (const v of Object.values(shortcut)) Validate.dword(v);
        slots[nIndex] = shortcut;
      }
      this.deps.taskbarService.setQueue(player, slots);
      logger.debug({ charId: player.m_idPlayer, nCount }, 'SKILLTASKBAR ok');
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'SKILLTASKBAR parse failed');
        return;
      }
      throw error;
    }
  }
}
