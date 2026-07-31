/**
 * CHEERING handler -- `PACKETTYPE_CHEERING` (0xffffff7c).
 *
 * `DPSrvr::OnCheering` (DPSrvr.cpp:7068) reads a single `OBJID objid` -- the
 * player being cheered -- then spends a cheer point and fans out the motion,
 * SFX, notice, facing and buff. All gating lives in the service.
 *
 * @module handlers/cheering.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CheerService } from '../services/cheer.service';

const logger = createLogger({ module: 'cheering-handler' });

export class CheeringHandler {
  constructor(
    private playerManager: PlayerManager,
    private cheerService: CheerService,
  ) {}

  handleCheering(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return; }

    let objid: number;
    try {
      objid = reader.readDword();
      Validate.dword(objid);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'CHEERING parse failed');
        return;
      }
      throw error;
    }

    const out = this.cheerService.cheer(player, objid);
    logger.debug({ charId: player.m_idPlayer, objid, out }, 'CHEERING');
  }
}
