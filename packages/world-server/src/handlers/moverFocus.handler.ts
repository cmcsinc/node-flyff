/**
 * MOVERFOCOUS handler -- `PACKETTYPE_MOVERFOCOUS` (0xffffff2d).
 *
 * `DPSrvr::OnMoverFocus` (DPSrvr.cpp:2154) reads `DWORD uidPlayer` and replies
 * SNAPSHOTTYPE_MOVERFOCUS with that player's gold + exp (GM target inspect).
 *
 * @module handlers/moverFocus.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { MoverFocusService } from '../services/moverFocus.service';

const logger = createLogger({ module: 'moverfocus-handler' });

export class MoverFocusHandler {
  constructor(
    private playerManager: PlayerManager,
    private moverFocusService: MoverFocusService,
  ) {}

  handleMoverFocus(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return; }

    let uidPlayer: number;
    try {
      uidPlayer = reader.readDword();
      Validate.dword(uidPlayer);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MOVERFOCOUS parse failed');
        return;
      }
      throw error;
    }

    const out = this.moverFocusService.focus(player, uidPlayer);
    logger.debug({ charId: player.m_idPlayer, uidPlayer, out }, 'MOVERFOCOUS');
  }
}
