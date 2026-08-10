/**
 * QUERYGETDESTOBJ handler -- `PACKETTYPE_QUERYGETDESTOBJ` (0xffffff72).
 *
 * `DPSrvr::OnQueryGetDestObj` (DPSrvr.cpp:1355) reads `OBJID objid` -- the
 * mover whose walk-to-object destination the client wants. Delegates to
 * {@link QueryGetDestObjService.query}, which returns a SNAPSHOT/GETDESTOBJ
 * frame when the mover has a destination; the handler frames + writes it back.
 *
 * @module handlers/queryGetDestObj.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { sendPacket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { QueryGetDestObjService } from '../services/queryGetDestObj.service';

const logger = createLogger({ module: 'queryGetDestObj-handler' });

export class QueryGetDestObjHandler {
  constructor(
    private playerManager: PlayerManager,
    private service: QueryGetDestObjService,
  ) {}

  handleQueryGetDestObj(socket: ClientSocket, reader: PacketReader): void {
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
        logger.warn({ err: error, charId: player.m_idPlayer }, 'QUERYGETDESTOBJ parse failed');
        return;
      }
      throw error;
    }

    const result = this.service.query(player, objid);
    if (result.reply) sendPacket(socket, result.reply);
  }
}
