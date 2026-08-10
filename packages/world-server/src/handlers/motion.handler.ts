/**
 * MOTION handler -- `PACKETTYPE_MOTION` (0x00ff0016).
 *
 * `DPSrvr::OnMotion` (DPSrvr.cpp:4827) reads `DWORD dwMsg` and broadcasts.
 *
 * @module handlers/motion.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { MotionService } from '../services/motion.service';

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
    const player = this.playerManager.get(socket.session.charId ?? -1);
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
