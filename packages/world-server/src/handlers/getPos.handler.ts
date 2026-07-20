/**
 * GETPOS handler — `PACKETTYPE_GETPOS` (0xffffff09).
 *
 * `DPSrvr::OnGetPos` (DPSrvr.cpp:1416) reads `Vec3 vPos, float fAngle, OBJID objid`.
 * NaN guard on `fAngle`, anti-teleport on `vPos`, then `SetPos`/`SetAngle`.
 *
 * @module handlers/getPos.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { MovementService } from '../services/movement.service.js';

const logger = createLogger({ module: 'getPos-handler' });

export class GetPosHandler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handleGetPos(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let pos: { x: number; y: number; z: number };
    let fAngle: number;
    let objid: number;
    try {
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();
      fAngle = reader.readFloat();
      objid = reader.readDword();
      pos = { x, y, z };
      Validate.pos(x, y, z);
      Validate.dword(objid);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'GETPOS parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.movementService.applyGetPos(player, pos, fAngle, objid);
    if (!outcome.ok) {
      logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'GETPOS rejected');
    }
  }
}
