/**
 * SETTARGET handler -- `PACKETTYPE_SETTARGET` (0x00ff0023).
 *
 * `DPSrvr::OnSetTarget` (DPSrvr.cpp:4295) reads `OBJID idTarget, BYTE bClear`.
 * bClear: 0=claim, 1=release, 2=set_objective.
 *
 * @module handlers/setTarget.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { TargetService } from '../services/target.service.js';

const logger = createLogger({ module: 'setTarget-handler' });

export class SetTargetHandler {
  constructor(
    private playerManager: PlayerManager,
    private targetService: TargetService,
  ) {}

  handleSetTarget(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let idTarget: number;
    let bClear: number;
    try {
      idTarget = reader.readDword();
      bClear = reader.readByte();
      Validate.dword(idTarget);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'SETTARGET parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.targetService.setTarget(player, idTarget, bClear);
    if (!outcome.ok) {
      logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'SETTARGET rejected');
    }
  }
}
