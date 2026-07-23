/**
 * SCRIPTDLG handler -- `PACKETTYPE_SCRIPTDLG` (0x00ff00b0).
 *
 * `DPSrvr::OnScriptDialogReq` (DPSrvr.cpp:887) reads:
 *   OBJID objid   String key(256)   int nGlobal1..nGlobal4
 *
 * 400ms rate-limit (`__QUEST_1203`). Delegates to {@link ScriptDlgService}.
 *
 * @module handlers/scriptDlg.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { sendPacket } from '@flyff/core/net/dispatcher';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '../managers/player.manager';
import type { ScriptDlgService } from '../services/scriptDlg.service';

const logger = createLogger({ module: 'scriptDlg-handler' });

/** Cap matching C++ `static TCHAR lpKey[256]` (DPSrvr.cpp:889). */
const MAX_SCRIPT_KEY = 255;

export class ScriptDlgHandler {
  constructor(
    private playerManager: PlayerManager,
    private scriptDlgService: ScriptDlgService,
  ) {}

  async handleScriptDlg(socket: ClientSocket, reader: PacketReader): Promise<void> {
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

    const outcome = await this.scriptDlgService.dialog(player, frame, Date.now());
    if (!outcome.ok) {
      if (outcome.reason === 'rate_limited')
        logger.debug({ charId: player.m_idPlayer }, 'SCRIPTDLG rate-limited');
      return;
    }
    // Frames are raw payloads (PacketWriter.build); sendPacket adds the 0x5E
    // wire frame. Raw socket.write here = unframed bytes the client drops.
    for (const buf of outcome.frames) sendPacket(socket, buf);
  }
}
