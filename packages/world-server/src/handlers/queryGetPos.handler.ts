/**
 * QUERYGETPOS handler -- `PACKETTYPE_QUERYGETPOS` (0xffffff08).
 *
 * `DPSrvr::OnQueryGetPos` (DPSrvr.cpp:1393) reads `OBJID objid` and replies
 * with the target mover's authoritative position. No `MoverManager` yet --
 * service logs and drops.
 *
 * @module handlers/queryGetPos.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { QueryGetPosService } from '../services/queryGetPos.service.js';

const logger = createLogger({ module: 'queryGetPos-handler' });

export class QueryGetPosHandler {
  constructor(
    private playerManager: PlayerManager,
    private queryGetPosService: QueryGetPosService,
  ) {}

  handleQueryGetPos(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let objid: number;
    try {
      objid = reader.readDword();
      Validate.dword(objid);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'QUERYGETPOS parse failed');
        return;
      }
      throw error;
    }

    this.queryGetPosService.query(player, objid);
  }
}
