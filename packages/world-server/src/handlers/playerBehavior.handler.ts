/**
 * PLAYERBEHAVIOR handler -- client->world `PACKETTYPE_PLAYERBEHAVIOR` (0xffffff02).
 *
 * Identical 60-byte body to PLAYERMOVED (DPSrvr.cpp:2349 OnPlayerBehavior).
 * Reuses `readMovementFrame` + `MovementService.applyBehavior` (which echoes a
 * MOVERBEHAVIOR broadcast without mutating position -- see movement.service).
 *
 * @module handlers/playerBehavior.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { type ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { MovementService } from '../services/movement.service.js';
import { readMovementFrame } from './playerMoved.handler.js';

const logger = createLogger({ module: 'playerBehavior-handler' });

export class PlayerBehaviorHandler {
  constructor(
    private playerManager: PlayerManager,
    private movementService: MovementService,
  ) {}

  handlePlayerBehavior(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) {
      socket.destroy();
      return;
    }

    let frame;
    try {
      frame = readMovementFrame(reader);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'PLAYERBEHAVIOR parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.movementService.applyBehavior(player, frame);
    if (!outcome.ok) {
      logger.debug({ charId: player.m_idPlayer }, 'PLAYERBEHAVIOR dropped');
    }
  }
}
