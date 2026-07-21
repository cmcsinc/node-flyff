/**
 * QUESTHELPER_REQNPCPOS handler — `PACKETTYPE_QUESTHELPER_REQNPCPOS` (0x70005000).
 *
 * Client asks "where is NPC `<charKey>`" for the quest-tracker map marker.
 * Resolves the placed NPC via {@link SpawnManager.findByCharacterKey} and writes
 * back `SNAPSHOTTYPE_QUESTHELPER_NPCPOS` (its world position). If the NPC isn't
 * spawned (e.g. in another world), C++ sends `TID_GAME_QUESTINFO_FAIL`; here we
 * silently drop — the defined-text frame ships with the dialog bridge (Phase 5).
 *
 * @module handlers/questHelper.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { sendPacket, type ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { SpawnManager } from '../managers/spawn.manager.js';
import { buildNpcPos } from '../net/snapshot/quest.serializer.js';

const logger = createLogger({ module: 'questHelper-handler' });
const MAX_CHAR_KEY = 255;

export class QuestHelperHandler {
  constructor(
    private playerManager: PlayerManager,
    private spawnManager: SpawnManager,
  ) {}

  handleQuestHelper(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let charKey: string;
    try {
      charKey = reader.readString();
      Validate.string(charKey, 0, MAX_CHAR_KEY);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'QUESTHELPER parse failed');
        return;
      }
      throw error;
    }

    const npc = this.spawnManager.findByCharacterKey(charKey);
    if (!npc) {
      // ponytail: send TID_GAME_QUESTINFO_FAIL defined-text once the text frame
      // lands with the dialog bridge (Phase 5). Silent for now.
      logger.debug({ charId: player.m_idPlayer, charKey }, 'QUESTHELPER NPC not spawned');
      return;
    }
    sendPacket(socket, buildNpcPos(player.m_idPlayer, npc.m_vPos));
  }
}
