/**
 * MOTION handler -- `PACKETTYPE_MOTION` (0x00ff0016).
 *
 * `DPSrvr::OnMotion` (DPSrvr.cpp:4827) reads `DWORD dwMsg` and broadcasts.
 *
 * @module handlers/motion.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { MotionService } from '../services/motion.service.js';

const logger = createLogger({ module: 'motion-handler' });

export class MotionHandler {
  constructor(
    private playerManager: PlayerManager,
    private motionService: MotionService,
  ) {}

  handleMotion(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let dwMsg: number;
    try {
      dwMsg = reader.readDword();
      Validate.dword(dwMsg);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MOTION parse failed');
        return;
      }
      throw error;
    }

    this.motionService.motion(player, dwMsg);
  }
}
