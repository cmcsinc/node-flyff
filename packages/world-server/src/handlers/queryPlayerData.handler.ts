/**
 * QUERY_PLAYER_DATA handler -- `PACKETTYPE_QUERY_PLAYER_DATA` (0xf000f802).
 *
 * Read order fixed by `WORLDSERVER/DPSrvr.cpp:1647` `OnQueryPlayerData`:
 *
 *   idPlayer:DWORD   nVer:int
 *
 * v15 Neuz sends this when opening guild/friend/party windows whose cached
 * `sPlayerData` is stale (`Neuz/DPClient.cpp:13340` `SendQueryPlayerData`). The
 * service stub returns no reply; the client keeps its existing cache. No rate
 * limiter yet (rule 03 flags it as repeatable -- add when the real reply ships).
 *
 * @module handlers/queryPlayerData.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { sendPacket } from '@flyff/core/net/dispatcher.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { createLogger } from '@flyff/core/logger.js';
import type { QueryPlayerDataService } from '../services/queryPlayerData.service.js';

const logger = createLogger({ module: 'query-player-data-handler' });

export class QueryPlayerDataHandler {
  constructor(private queryPlayerDataService: QueryPlayerDataService) {}

  async handleQueryPlayerData(socket: ClientSocket, reader: PacketReader): Promise<void> {
    let idPlayer: number;
    let nVer: number;
    let charId: number;
    try {
      if (socket.session.state !== SessionState.IN_WORLD) {
        logger.warn({ state: socket.session.state }, 'QUERY_PLAYER_DATA before IN_WORLD -- dropping');
        socket.destroy();
        return;
      }
      charId = socket.session.charId ?? -1;
      idPlayer = reader.readDword();
      nVer = reader.readLong();
      Validate.dword(idPlayer);
    } catch (error) {
      logger.error({ error }, 'QUERY_PLAYER_DATA parse failed');
      socket.destroy();
      return;
    }

    const result = this.queryPlayerDataService.query(charId, idPlayer, nVer);
    if (result.reply) sendPacket(socket, result.reply);

    logger.debug({ charId, idPlayer, nVer, remaining: reader.remaining }, 'QUERY_PLAYER_DATA');
  }
}
