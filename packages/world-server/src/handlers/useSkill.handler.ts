/**
 * USESKILL handler -- `PACKETTYPE.USESKILL` (0x00ff0020).
 *
 * `DPSrvrLux::OnUseSkill` (`DPSrvrLux.cpp:32`) reads:
 *   WORD wType(=0) | WORD wId(slot 0..44) | DWORD objid(target) |
 *   int nUseType(SUT) | BOOL bControl(4B)
 * `wId` is the slot INDEX (not skill id). On any gate failure the service sends
 * CLEAR_USESKILL (0x001a) to the caster; the handler just reports the drop.
 *
 * @module handlers/useSkill
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { SkillService } from '../services/skill.service';
import { MAX_SKILL_JOB } from '../net/snapshot/constants';

const logger = createLogger({ module: 'useSkill-handler' });

export class UseSkillHandler {
  constructor(
    private playerManager: PlayerManager,
    private skillService: SkillService,
  ) {}

  handleUseSkill(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      reader.readWord(); // wType -- always 0, consumed for stream alignment
      const wId = reader.readWord();
      const objid = reader.readDword();
      const nUseType = reader.readLong();
      reader.readLong(); // bControl (BOOL 4B) -- consumed, unused server-side
      Validate.dword(objid);
      Validate.slot(wId, MAX_SKILL_JOB);
      const outcome = this.skillService.cast(player, { wId, objid, useType: nUseType });
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'USESKILL dropped');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'USESKILL parse failed');
        return;
      }
      throw error;
    }
  }
}
