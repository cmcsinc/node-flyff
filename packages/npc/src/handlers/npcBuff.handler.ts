/**
 * NPC_BUFF handler -- `PACKETTYPE_NPC_BUFF` (0xf000f813).
 *
 * `CDPSrvr::OnNPCBuff` (DPSrvr.cpp:11243) reads one DWORD-prefixed string
 * `szKey[64]` -- the buff-pang NPC's character.inc block key. Rate-limited
 * (1s) inside the service. The service broadcasts S->C snapshots directly via
 * `zoneManager` (SETSKILLSTATE / SETDESTPARAM / DOAPPLYUSESKILL), so the handler
 * writes nothing back.
 *
 * @module handlers/npcBuff.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { NpcBuffService } from '../services/npcBuff.service';

const logger = createLogger({ module: 'npcBuff-handler' });

/** C++ reads `CHAR m_szKey[64]` (DPSrvr.cpp:11248) -- wire string ≤ 63 chars + NUL. */
const MAX_NPC_BUFF_KEY = 63;

export class NpcBuffHandler {
  constructor(
    private playerManager: PlayerManager,
    private npcBuffService: NpcBuffService,
  ) {}

  handleNpcBuff(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    let key: string;
    try {
      key = reader.readString();
      Validate.string(key, 0, MAX_NPC_BUFF_KEY);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'NPC_BUFF parse failed');
        return;
      }
      throw error;
    }

    const outcome = this.npcBuffService.buff(player, key, Date.now());
    if (!outcome.ok) {
      logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'NPC_BUFF rejected');
    }
  }
}
