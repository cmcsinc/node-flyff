/**
 * PLAYERSETDESTOBJ handler -- `PACKETTYPE_PLAYERSETDESTOBJ` (0xffffff07).
 *
 * `DPSrvr::OnPlayerSetDestObj` (DPSrvr.cpp:2571) reads `OBJID objid, float
 * fRange` (8-byte body). Server records the destination obj; peer clients run
 * their own pathfinding to it. Delegates to
 * {@link MovementService.applySetDestObj} (dedup + broadcast).
 *
 * @module handlers/playerSetDestObj.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { MovementService } from '../services/movement.service.js';

const logger = createLogger({ module: 'playerSetDestObj-handler' });

export class PlayerSetDestObjHandler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handlePlayerSetDestObj(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const objid = reader.readDword();
      const fRange = reader.readFloat();
      Validate.dword(objid);
      if (!Number.isFinite(fRange)) {
        throw new PacketError('fRange must be finite');
      }
      logger.info(
        { charId: player.m_idPlayer, objid, fRange, from: player.m_vPos },
        'PLAYERSETDESTOBJ received',
      );
      this.movementService.applySetDestObj(player, objid, fRange);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERSETDESTOBJ parse failed');
        return;
      }
      throw error;
    }
  }
}
