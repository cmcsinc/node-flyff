/**
 * REMOVEQUEST handler -- `PACKETTYPE_REMOVEQUEST` (0x00ff0026).
 *
 * `DPSrvr::OnRemoveQuest` (DPSrvr.cpp:1107) reads `DWORD dwQuestCancelID` and
 * is 400ms rate-limited via `m_tickScript`. Delegates to
 * {@link QuestService.cancelQuest}, which drops the active record, audits the
 * cancel (action 30), and returns the QUEST_REMOVE frame to write back.
 *
 * @module handlers/removeQuest.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { sendPacket, type ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { QuestService } from '../services/quest.service';

const logger = createLogger({ module: 'removeQuest-handler' });

/** C++ rate limit on quest-script ops (`m_tickScript`, DPSrvr.cpp:903). */
const SCRIPT_RATE_MS = 400;

export class RemoveQuestHandler {
  constructor(
    private playerManager: PlayerManager,
    private questService: QuestService,
  ) {}

  async handleRemoveQuest(socket: ClientSocket, reader: PacketReader): Promise<void> {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let questId: number;
    try {
      questId = reader.readDword();
      Validate.dword(questId);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'REMOVEQUEST parse failed');
        return;
      }
      throw error;
    }

    const now = Date.now();
    if (now - player.m_tickScript < SCRIPT_RATE_MS) {
      logger.debug({ charId: player.m_idPlayer }, 'REMOVEQUEST rate-limited');
      return;
    }
    player.m_tickScript = now;

    const outcome = await this.questService.cancelQuest(player, questId);
    if (outcome.ok) {
      for (const frame of outcome.frames) sendPacket(socket, frame);
    } else {
      logger.debug({ charId: player.m_idPlayer, questId, reason: outcome.reason }, 'REMOVEQUEST rejected');
    }
  }
}
