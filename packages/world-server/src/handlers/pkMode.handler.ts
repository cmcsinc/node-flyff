/**
 * PkModeHandler -- `PACKETTYPE_MODE` (0xffffff7b) PK branch.
 *
 * The v19 client sends `DWORD dwMode` to toggle PK mode. `dwMode=1` = PK on,
 * `dwMode=0` = PK off. The server sets `player.m_bPKMode`, which gates PvP
 * targeting + damage routing in the combat pipeline.
 *
 * The same MODE opcode also serves GM toggles (ONEKILL / MATCHLESS / TRANSPARENT)
 * but those are already handled through `/ok` `/inv` `/ma` chat commands in
 * `command.service.ts` -- this handler only processes the PK bit.
 *
 * @module handlers/pkMode.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { PkModeService } from '../services/pkMode.service';

const logger = createLogger({ module: 'pkMode-handler' });

export class PkModeHandler {
  constructor(
    private playerManager: PlayerManager,
    private pkModeService: PkModeService,
  ) {}

  handleMode(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    // Dead or stunned players cannot toggle PK mode.
    if (player.m_bDead || player.isStunned()) return;

    try {
      const dwMode = reader.readDword();
      Validate.dword(dwMode);
      this.pkModeService.toggle(player, dwMode);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MODE parse failed');
        return;
      }
      throw error;
    }
  }
}