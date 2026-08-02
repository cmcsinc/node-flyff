/**
 * PLAYERANGLE handler -- `PACKETTYPE_PLAYERANGLE` (0xffffff29).
 *
 * 48-byte body (DPSrvr.cpp:2536 OnPlayerAngle):
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
import type { AngleFrame } from '../net/snapshot/moverBroadcast.serializer';

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
      const frame = readAngleFrame(reader);
      const outcome = this.movementService.applyAngle(player, frame);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'PLAYERANGLE dropped');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERANGLE parse failed');
        return;
      }
      throw error;
    }
  }
}

/** Read + validate the 44-byte PLAYERANGLE body (`DPSrvr.cpp:2536`). */
export function readAngleFrame(reader: PacketReader): AngleFrame {
  const v = { x: reader.readFloat(), y: reader.readFloat(), z: reader.readFloat() };
  const vd = { x: reader.readFloat(), y: reader.readFloat(), z: reader.readFloat() };
  const f = reader.readFloat();
  const fAngleX = reader.readFloat();
  const fAccPower = reader.readFloat();
  const fTurnAngle = reader.readFloat();
  const nTickCount = reader.readQword();
  Validate.pos(v.x, v.y, v.z);
  Validate.pos(vd.x, vd.y, vd.z);
  return { v, vd, f, fAngleX, fAccPower, fTurnAngle, nTickCount };
}
