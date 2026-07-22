/**
 * REVIVAL / REVIVAL_TO_LODESTAR / REVIVAL_TO_LODELIGHT handlers.
 *
 * Mirror `DPSrvr::OnRevival` / `OnRevivalLodestar` / `OnRevivalLodelight`
 * (DPSrvr.cpp:960/1061/1188). All three read no body -- the opcode alone selects
 * the revival branch. Lodelight is a C++ empty stub; rejected with a warn.
 *
 * @module handlers/revival.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { RevivalService, RevivalType } from '../services/revival.service.js';

const logger = createLogger({ module: 'revival-handler' });

export class RevivalHandler {
  constructor(
    private playerManager: PlayerManager,
    private revivalService: RevivalService,
  ) {}

  /** Dispatch helper -- guards session + player existence, forwards to the service. */
  private revive(socket: ClientSocket, type: RevivalType): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    const outcome = this.revivalService.revive(player, type);
    if (!outcome.ok) {
      logger.warn({ charId: player.m_idPlayer, type }, `REVIVAL rejected: ${outcome.reason}`);
    }
  }

  /** `OnRevival` (0x00ff00c0) -- scroll revive in place. */
  handleRevival(socket: ClientSocket, _reader: PacketReader): void {
    this.revive(socket, 'SCROLL');
  }

  /** `OnRevivalLodestar` (0x00ff00c1) -- town revive with exp penalty + teleport. */
  handleRevivalLodestar(socket: ClientSocket, _reader: PacketReader): void {
    this.revive(socket, 'LODESTAR');
  }

  /** `OnRevivalLodelight` (0x00ff00c2) -- C++ empty stub. Rejected. */
  handleRevivalLodelight(socket: ClientSocket, _reader: PacketReader): void {
    this.revive(socket, 'LODELIGHT');
  }
}
