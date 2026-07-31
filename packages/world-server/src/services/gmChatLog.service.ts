/**
 * GmChatLogService -- `PACKETTYPE_LOG_GAMEMASTER_CHAT` (0x0f000f09).
 *
 * `DPSrvr::OnGameMasterWhisper` (`WORLDSERVER/DPSrvr.cpp:6677`) is pure audit
 * plumbing:
 *
 *   ar.ReadString( sPlayerFrom, MAX_PLAYER );   // 42
 *   ar.ReadString( lpString, 260 );
 *   sprintf( szChat, "%s -> %s", sPlayerFrom, lpString );
 *   g_dpDBClient.SendLogGamemaChat( pUser, szChat );
 *
 * `SendLogGamemaChat` (`DPDatabaseClient.cpp:2021`) forwards
 * `[DWORD m_idPlayer][String szChat]` to the DatabaseServer, which writes it to
 * the GM chat log table. There is no reply and no game-state effect.
 *
 * This emulator has no DatabaseServer, so the sink is the structured `pino`
 * log at `info` — same audit trail, different destination. ponytail: route to a
 * `gm_chat_log` table (or the admin panel's live-ops feed) when a chat-audit
 * store lands; the seam is this one method.
 *
 * No WAL (rule 04 -- chat is explicitly not journaled).
 *
 * @module services/gmChatLog.service
 */

import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';

const logger = createLogger({ module: 'gm-chat-log' });

export class GmChatLogService {
  /**
   * Record one audited chat line.
   *
   * @param reporter - The player whose client self-reported (`pUser`).
   * @param from - Name the message came from (`sPlayerFrom`).
   * @param text - Message body (`lpString`).
   */
  log(reporter: CPlayer, from: string, text: string): void {
    logger.info(
      { charId: reporter.m_idPlayer, reporter: reporter.m_szName, from, chat: `${from} -> ${text}` },
      'GM chat log',
    );
  }
}
