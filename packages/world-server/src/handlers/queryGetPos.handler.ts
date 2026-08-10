/**
 * QUERYGETPOS handler -- `PACKETTYPE_QUERYGETPOS` (0xffffff08).
 *
 * `DPSrvr::OnQueryGetPos` (DPSrvr.cpp:1393) reads `OBJID objid` and replies
 * with the target mover's authoritative position. No `MoverManager` yet --
 * service logs and drops.
 *
 * @module handlers/queryGetPos.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { QueryGetPosService } from '../services/queryGetPos.service';

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
    const player = this.playerManager.get(socket.session.charId ?? -1);
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
