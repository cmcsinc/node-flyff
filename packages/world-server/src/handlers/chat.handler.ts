/**
 * CHAT handler — `PACKETTYPE_CHAT` (0x00ff0000).
 *
 * `DPSrvr::OnChat` (DPSrvr.cpp:663) reads one DWORD-length-prefixed string,
 * capped at 1024 bytes (packet-level cap `uBufSize > 1031 ⇒ drop`).
 *
 * Handler reads + validates the string, delegates broadcast/command to
 * {@link ChatService}. No reply on any path — service broadcasts CHATTEXT
 * to zone peers.
 *
 * @module handlers/chat.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ChatService } from '../services/chat.service.js';
import { MAX_CHAT_LEN } from '../services/chat.service.js';

const logger = createLogger({ module: 'chat-handler' });

export class ChatHandler {
  constructor(
    private playerManager: PlayerManager,
    private chatService: ChatService,
  ) {}

  handleChat(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let text: string;
    try {
      text = reader.readString();
      if (text.length > MAX_CHAT_LEN) {
        logger.warn({ charId: player.m_idPlayer, len: text.length }, 'CHAT over cap — dropping');
        return;
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'CHAT parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.chatService.chat(player, text);
    if (!outcome.ok && outcome.reason === 'command_unknown') {
      logger.debug({ charId: player.m_idPlayer }, 'CHAT unknown command — dropped');
    }
  }
}
