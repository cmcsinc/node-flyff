/**
 * PLAYERMOVED2 handler -- `PACKETTYPE_PLAYERMOVED2` (0xffffff03).
 *
 * 73-byte body (DPSrvr.cpp:2397 OnPlayerMoved2): adds 3 floats + a trailing
 * BYTE vs PLAYERMOVED. C++ only acts when flying; we always process (no flight
 * model yet). Delegates to {@link MovementService.applyMoved2}.
 *
 * @module handlers/playerMoved2.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '../managers/player.manager';
import type { MovementService } from '../services/movement.service';
import type { Movement2Frame } from '../net/snapshot/moverBroadcast.serializer';

const logger = createLogger({ module: 'playerMoved2-handler' });

export class PlayerMoved2Handler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handlePlayerMoved2(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const frame = readMovement2Frame(reader);
      const outcome = this.movementService.applyMoved2(player, frame);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer }, 'PLAYERMOVED2 dropped (anti-teleport)');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERMOVED2 parse failed');
        return;
      }
      throw error;
    }
  }
}

/** Read the 73-byte PLAYERMOVED2 body. */
export function readMovement2Frame(reader: PacketReader): Movement2Frame {
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
  const nFrame = reader.readByte();
  Validate.pos(v.x, v.y, v.z);
  Validate.pos(vd.x, vd.y, vd.z);
  Validate.dword(dwState);
  Validate.dword(dwStateFlag);
  Validate.dword(dwMotion);
  Validate.dword(dwMotionOption);
  return {
    v, vd, f, fAngleX, fAccPower, fTurnAngle,
    dwState, dwStateFlag, dwMotion, nMotionEx, nLoop, dwMotionOption,
    nTickCount, nFrame,
  };
}

function readVec3(reader: PacketReader) {
  const x = reader.readFloat();
  const y = reader.readFloat();
  const z = reader.readFloat();
  return { x, y, z };
}
