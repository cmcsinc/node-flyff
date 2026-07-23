/**
 * PLAYERANGLE handler -- `PACKETTYPE_PLAYERANGLE` (0xffffff29).
 *
 * 45-byte body (DPSrvr.cpp:2513 OnPlayerAngle):
 *   v:Vec3  vd:Vec3  f:float  fAngleX:float  fAccPower:float  fTurnAngle:float
 *   nTickCount:__int64
 *
 * C++ only acts when flying. With no flight model we accept + drop (no echo).
 *
 * @module handlers/playerAngle.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { MovementService } from '../services/movement.service';

const logger = createLogger({ module: 'playerAngle-handler' });

export class PlayerAngleHandler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handlePlayerAngle(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      // Skip the 45-byte body -- see module doc for field layout.
      readAngleFrame(reader);
      this.movementService.applyAngle(player, Date.now());
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERANGLE parse failed');
        return;
      }
      throw error;
    }
  }
}

/** Read + validate the 45-byte PLAYERANGLE body (values discarded -- see module doc). */
function readAngleFrame(reader: PacketReader): void {
  reader.readFloat(); reader.readFloat(); reader.readFloat(); // v
  reader.readFloat(); reader.readFloat(); reader.readFloat(); // vd
  const f = reader.readFloat();
  reader.readFloat(); // fAngleX
  reader.readFloat(); // fAccPower
  reader.readFloat(); // fTurnAngle
  const nTickCount = reader.readQword();
  Validate.pos(f, f, f);
  void nTickCount;
}
