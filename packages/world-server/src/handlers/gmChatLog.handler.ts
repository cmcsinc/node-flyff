/**
 * LOG_GAMEMASTER_CHAT handler -- `PACKETTYPE_LOG_GAMEMASTER_CHAT` (0x0f000f09).
 *
 * `DPSrvr::OnGameMasterWhisper` (DPSrvr.cpp:6677) reads
 * `[String sPlayerFrom(<=42)][String lpString(<=260)]` and forwards the pair to
 * the DB log server. The client self-reports here from `OnWhisper`
 * (`Neuz/DPClient.cpp:11922`) when the RECEIVER holds `AUTH_LOGCHATTING` ('G')
 * or higher — so the packet only ever arrives from a GM-ish account.
 *
 * C++ does not re-check authority; we do (rule 03 — a patched client must not be
 * able to spam the audit log). Bounds mirror the C++ `ReadString` caps exactly:
 * `MAX_PLAYER` = 42 (`_Network/CmnHdr.h:486`) and 260.
 *
 * @module handlers/gmChatLog.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import { AUTH, hasAuthority } from '@flyff/entities';
import type { GmChatLogService } from '../services/gmChatLog.service';

const logger = createLogger({ module: 'gmchatlog-handler' });

/** `MAX_PLAYER` (`_Network/CmnHdr.h:486`) — the C++ `ReadString` cap for the name. */
const MAX_FROM_LEN = 42;
/** The C++ `ReadString( lpString, 260 )` cap. */
const MAX_TEXT_LEN = 260;

export class GmChatLogHandler {
  constructor(
    private playerManager: PlayerManager,
    private gmChatLogService: GmChatLogService,
  ) {}

  handleGmChatLog(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return; }

    let from: string;
    let text: string;
    try {
      from = reader.readString();
      text = reader.readString();
      Validate.string(from, 0, MAX_FROM_LEN);
      Validate.string(text, 0, MAX_TEXT_LEN);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'LOG_GAMEMASTER_CHAT parse failed');
        return;
      }
      throw error;
    }

    if (!hasAuthority(player.m_bAuthority, AUTH.LOGCHATTING)) {
      logger.warn({ charId: player.m_idPlayer, auth: player.m_bAuthority },
        'LOG_GAMEMASTER_CHAT from non-GM -- dropping');
      return;
    }
    if (text.length === 0) return;

    this.gmChatLogService.log(player, from, text);
  }
}
