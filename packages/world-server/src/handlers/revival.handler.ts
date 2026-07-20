/**
 * REVIVAL handler — `PACKETTYPE_REVIVAL` (0x00ff00c0).
 *
 * `DPSrvr::OnRevival` (DPSrvr.cpp:960) reads no body. Rejects live players.
 *
 * @module handlers/revival.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { RevivalService } from '../services/revival.service.js';

const logger = createLogger({ module: 'revival-handler' });

export class RevivalHandler {
  constructor(
    private playerManager: PlayerManager,
    private revivalService: RevivalService,
  ) {}

  handleRevival(socket: ClientSocket, _reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    const outcome = this.revivalService.revive(player);
    if (!outcome.ok) {
      // C++ logs an Error here; we mirror with warn (not dead = no-op spam risk).
      logger.warn({ charId: player.m_idPlayer }, 'REVIVAL while not dead');
    }
  }
}
