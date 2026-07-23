/**
 * QUEST_CHECK handler -- `PACKETTYPE_QUEST_CHECK` (0x88100110).
 *
 * `DPSrvr::OnQuestCheck` reads `int nQuestId, BOOL(4B) bCheck` and toggles the
 * quest in the player's "checked" (tracked) list -- cap `MAX_CHECKED_QUEST`.
 * Delegates to {@link QuestService.setChecked}, which returns the QUEST_CHECKED
 * frame (full replace) to write back.
 *
 * @module handlers/questCheck.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { sendPacket, type ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '../managers/player.manager';
import type { QuestService } from '../services/quest.service';

const logger = createLogger({ module: 'questCheck-handler' });

export class QuestCheckHandler {
  constructor(
    private playerManager: PlayerManager,
    private questService: QuestService,
  ) {}

  async handleQuestCheck(socket: ClientSocket, reader: PacketReader): Promise<void> {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let questId: number;
    let bCheck: number;
    try {
      questId = reader.readLong();
      bCheck = reader.readLong();
      Validate.dword(questId);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'QUEST_CHECK parse failed');
        return;
      }
      throw error;
    }

    const frame = await this.questService.setChecked(player, questId, bCheck !== 0);
    sendPacket(socket, frame);
  }
}
