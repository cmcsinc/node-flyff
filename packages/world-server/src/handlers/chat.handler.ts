/**
 * CHAT handler -- `PACKETTYPE_CHAT` (0x00ff0000).
 *
 * `DPSrvr::OnChat` (`DPSrvr.cpp:663`) reads a single field:
 *   text:String(DWORD-len + chars, <=1024)
 * and drops the whole packet when `uBufSize > 1031` (4 + 4 + 1024 - 1).
 *
 * The client sends no authority DWORD -- `CDPClient::SendChat` (`Neuz/DPClient.cpp
 * :9003`) writes ONLY `ar.WriteString(lpszChat)` after the opcode. Reading a
 * `dwAuth` here eats the string-length DWORD and the next `readString` then
 * decodes the text bytes as a length -> `Buffer overrun` (verified: "test" ->
 * requested=0x74736574). Server-side `m_bAuthority` alone gates commands.
 *
 * Handler reads + validates, delegates broadcast/command to `ChatService`. No
 * reply on any path -- the service broadcasts CHATTEXT to zone peers.
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
        logger.warn({ charId: player.m_idPlayer, len: text.length }, 'CHAT over cap -- dropping');
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
    logger.info(
      { charId: player.m_idPlayer, auth: player.m_bAuthority, text, ok: outcome.ok, ...(outcome.ok ? { reached: outcome.reached } : { reason: outcome.reason }) },
      'CHAT received',
    );
    if (!outcome.ok) {
      if (outcome.reason === 'command_unknown' || outcome.reason === 'command_no_auth') {
        logger.debug(
          { charId: player.m_idPlayer, reason: outcome.reason },
          'CHAT command rejected -- dropped',
        );
      }
    }
  }
}
