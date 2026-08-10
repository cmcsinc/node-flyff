/**
 * PLAYERMOVED handler -- client->world `PACKETTYPE_PLAYERMOVED` (0xffffff01).
 *
 * 60-byte body (DPSrvr.cpp:2271 OnPlayerMoved):
 *   v:Vec3  vd:Vec3  f:float(angle)
 *   dwState:DWORD  dwStateFlag:DWORD  dwMotion:DWORD
 *   nMotionEx:int32  nLoop:int32  dwMotionOption:DWORD  nTickCount:__int64
 *
 * Handler reads + validates -> one `MovementService.applyMovement` call. No reply
 * (service broadcasts MOVERMOVED to peers).
 *
 * @module handlers/playerMoved.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import { type ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { MovementService } from '../services/movement.service';
import type { MovementFrame } from '../net/snapshot/moverBroadcast.serializer';

const logger = createLogger({ module: 'playerMoved-handler' });

export class PlayerMovedHandler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handlePlayerMoved(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) {
      socket.destroy();
      return;
    }

    let frame: MovementFrame;
    try {
      frame = readMovementFrame(reader);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERMOVED parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.movementService.applyMovement(player, frame);
    if (!outcome.ok) {
      logger.debug({ charId: player.m_idPlayer }, 'PLAYERMOVED dropped (anti-teleport)');
    }
  }
}

/** Read the 60-byte PLAYERMOVED/PLAYERBEHAVIOR body. */
export function readMovementFrame(reader: PacketReader): MovementFrame {
  const v = readVec3(reader);
  const vd = readVec3(reader);
  const f = reader.readFloat();
  const dwState = reader.readDword();
  const dwStateFlag = reader.readDword();
  const dwMotion = reader.readDword();
  const nMotionEx = reader.readLong();
  const nLoop = reader.readLong();
  const dwMotionOption = reader.readDword();
  const nTickCount = reader.readQword();
  Validate.pos(v.x, v.y, v.z);
  Validate.pos(vd.x, vd.y, vd.z);
  Validate.dword(dwState);
  Validate.dword(dwStateFlag);
  Validate.dword(dwMotion);
  Validate.dword(dwMotionOption);
  return { v, vd, f, dwState, dwStateFlag, dwMotion, nMotionEx, nLoop, dwMotionOption, nTickCount };
}

function readVec3(reader: PacketReader) {
  const x = reader.readFloat();
  const y = reader.readFloat();
  const z = reader.readFloat();
  return { x, y, z };
}
