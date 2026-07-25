/**
 * DOUSESKILLPOINT handler -- `PACKETTYPE.DOUSESKILLPOINT` (0x000f0003).
 *
 * `DPSrvr::OnDoUseSkillPoint` (`DPSrvr.cpp:3305`) reads `MAX_SKILL_JOBx
 * (DWORD dwSkill, DWORD dwLevel)` -- the player's desired job-skill roster,
 * one entry per slot, no count prefix. (MAX_SKILL_JOB is 51 under v19
 * `__3RD_LEGEND16`, 45 on v15.) The service validates atomically
 * (all-or-nothing); on reject no confirm is sent and the client keeps its
 * prior state.
 *
 * @module handlers/doUseSkillPoint
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { SkillService } from '../services/skill.service';
import { MAX_SKILL_JOB } from '@flyff/world-core';

const logger = createLogger({ module: 'doUseSkillPoint-handler' });

export class DoUseSkillPointHandler {
  constructor(
    private playerManager: PlayerManager,
    private skillService: SkillService,
  ) {}

  handleDoUseSkillPoint(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const requested: Array<{ skillId: number; level: number }> = [];
      for (let i = 0; i < MAX_SKILL_JOB; i++) {
        const skillId = reader.readDword();
        const level = reader.readDword();
        Validate.dword(skillId);
        Validate.dword(level);
        requested.push({ skillId, level });
      }
      const outcome = this.skillService.learnSkills(player, requested);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'DOUSESKILLPOINT rejected');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'DOUSESKILLPOINT parse failed');
        return;
      }
      throw error;
    }
  }
}
