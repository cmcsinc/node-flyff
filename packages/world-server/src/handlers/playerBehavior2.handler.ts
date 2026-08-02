/**
 * PLAYERBEHAVIOR2 handler -- `PACKETTYPE_PLAYERBEHAVIOR2` (0xffffff04).
 *
 * Flight-motion counterpart to PLAYERBEHAVIOR. Wire layout matches PLAYERMOVED2
 * except there is NO trailing `nFrame:BYTE` (72-byte body):
 * `v, vd, f, fAngleX, fAccPower, fTurnAngle, dwState, dwStateFlag, dwMotion,
 * nMotionEx, nLoop, dwMotionOption, nTickCount`.
 *
 * C++ `CDPSrvr::OnPlayerBehavior2` (`DPSrvr.cpp:2490`) hard-drops this packet
 * while grounded; `MovementService.applyBehavior2` owns that gate and the peer
 * echo (`SNAPSHOTTYPE_MOVERBEHAVIOR2`).
 *
 * @module handlers/playerBehavior2
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { MovementService } from '../services/movement.service';
import type { Movement2Frame } from '../net/snapshot/moverBroadcast.serializer';

const logger = createLogger({ module: 'playerBehavior2-handler' });

export class PlayerBehavior2Handler {
  constructor(
    private readonly playerManager: PlayerManager,
    private readonly movementService: MovementService,
  ) {}

  handlePlayerBehavior2(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const frame = readMovementBehavior2Frame(reader);
      const outcome = this.movementService.applyBehavior2(player, frame);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'PLAYERBEHAVIOR2 dropped');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERBEHAVIOR2 parse failed');
        return;
      }
      throw error;
    }
  }
}

/** Read the 72-byte PLAYERBEHAVIOR2 body (`DPSrvr.cpp:2490`). */
export function readMovementBehavior2Frame(reader: PacketReader): Movement2Frame {
  const v = readVec3(reader);
  const vd = readVec3(reader);
  const f = reader.readFloat();
  const fAngleX = reader.readFloat();
  const fAccPower = reader.readFloat();
  const fTurnAngle = reader.readFloat();
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
  return {
    v, vd, f, fAngleX, fAccPower, fTurnAngle,
    dwState, dwStateFlag, dwMotion, nMotionEx, nLoop, dwMotionOption,
    nTickCount,
    // This field does not exist on PLAYERBEHAVIOR2. Movement2Frame carries it to
    // share the serializer type; buildBehavior2 deliberately never writes it.
    nFrame: 0,
  };
}

function readVec3(reader: PacketReader): { x: number; y: number; z: number } {
  return { x: reader.readFloat(), y: reader.readFloat(), z: reader.readFloat() };
}
