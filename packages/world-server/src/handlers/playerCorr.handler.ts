/**
 * PLAYERCORR handler — `PACKETTYPE_PLAYERCORR` (0xffffff05).
 *
 * Same 60-byte body as PLAYERMOVED (DPSrvr.cpp:2651 OnPlayerCorr). Delegates to
 * {@link MovementService.applyCorr} — anti-teleport + echo MOVERCORR.
 *
 * @module handlers/playerCorr.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { MovementService } from '../services/movement.service.js';
import { readMovementFrame } from './playerMoved.handler.js';

const logger = createLogger({ module: 'playerCorr-handler' });

export class PlayerCorrHandler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handlePlayerCorr(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const frame = readMovementFrame(reader);
      const outcome = this.movementService.applyCorr(player, frame);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer }, 'PLAYERCORR dropped (anti-teleport)');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERCORR parse failed');
        return;
      }
      throw error;
    }
  }
}
