/**
 * MODIFY_STATUS handler -- `PACKETTYPE.MODIFY_STATUS` (0xf000f501).
 *
 * `DPSrvr::OnModifyStatus` (`DPSrvr.cpp:10345`) reads four DWORDs:
 * `nStrCount | nStaCount | nDexCount | nIntCount`. The service validates
 * (each `>= 0`, sum `> 0`, `<= m_nRemainGP`) and on reject sends nothing --
 * the client keeps its prior stat window. Neuz send site:
 * `CDPClient::SendModifyStatus` (`Neuz/DPClient.cpp:16477`), driven by the stat
 * `+` buttons (`_Interface/WndField.cpp:4453`).
 *
 * @module handlers/modifyStatus
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { StatService } from '../services/stat.service.js';

const logger = createLogger({ module: 'modifyStatus-handler' });

export class ModifyStatusHandler {
  constructor(
    private playerManager: PlayerManager,
    private statService: StatService,
  ) {}

  handleModifyStatus(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const str = reader.readDword();
      const sta = reader.readDword();
      const dex = reader.readDword();
      const int = reader.readDword();
      Validate.dword(str);
      Validate.dword(sta);
      Validate.dword(dex);
      Validate.dword(int);

      const outcome = this.statService.applyStatPoints(player, { str, sta, dex, int });
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'MODIFY_STATUS rejected');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MODIFY_STATUS parse failed');
        return;
      }
      throw error;
    }
  }
}
