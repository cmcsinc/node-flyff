/**
 * SCRIPTDLG handler — `PACKETTYPE_SCRIPTDLG` (0x00ff00b0).
 *
 * `DPSrvr::OnScriptDialogReq` (DPSrvr.cpp:887) reads:
 *   OBJID objid   String key(256)   int nGlobal1..nGlobal4
 *
 * 400ms rate-limit (`__QUEST_1203`). Delegates to {@link ScriptDlgService}.
 *
 * @module handlers/scriptDlg.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ScriptDlgService } from '../services/scriptDlg.service.js';

const logger = createLogger({ module: 'scriptDlg-handler' });

/** Cap matching C++ `static TCHAR lpKey[256]` (DPSrvr.cpp:889). */
const MAX_SCRIPT_KEY = 255;

export class ScriptDlgHandler {
  constructor(
    private playerManager: PlayerManager,
    private scriptDlgService: ScriptDlgService,
  ) {}

  handleScriptDlg(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let frame;
    try {
      const objid = reader.readDword();
      const key = reader.readString();
      const nGlobal1 = reader.readLong();
      const nGlobal2 = reader.readLong();
      const nGlobal3 = reader.readLong();
      const nGlobal4 = reader.readLong();
      Validate.dword(objid);
      Validate.string(key, 0, MAX_SCRIPT_KEY);
      frame = { objid, key, nGlobal1, nGlobal2, nGlobal3, nGlobal4 };
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'SCRIPTDLG parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.scriptDlgService.dialog(player, frame, Date.now());
    if (!outcome.ok && outcome.reason === 'rate_limited') {
      logger.debug({ charId: player.m_idPlayer }, 'SCRIPTDLG rate-limited');
    }
  }
}
