/**
 * MELEE_ATTACK handler -- `PACKETTYPE_MELEE_ATTACK` (0x00ff0010).
 *
 * `DPSrvr::OnMeleeAttack` (DPSrvr.cpp:4131) reads `DWORD dwAtkMsg, OBJID objid,
 * int nParam2, int nParam3` + a trailing `float fVal` under `__HACK_1023`
 * (active in v15 -- anti-cheat echo of the weapon's fAttackSpeed). `fVal` is
 * consumed to keep the stream aligned but otherwise ignored until the inventory
 * system ships.
 *
 * Motion-only: delegates to {@link MeleeAttackService.attack}, which broadcasts
 * the swing to peers. Damage is deferred (combat system, Tier 0).
 *
 * @module handlers/meleeAttack.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { MeleeAttackService } from '../services/meleeAttack.service';
import type { MeleeAttackFrame } from '../net/snapshot/meleeAttack.serializer';

const logger = createLogger({ module: 'meleeAttack-handler' });

export class MeleeAttackHandler {
  constructor(
    private playerManager: PlayerManager,
    private meleeAttackService: MeleeAttackService,
  ) {}

  handleMeleeAttack(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const dwAtkMsg = reader.readDword();
      const objid = reader.readDword();
      const nParam2 = reader.readLong();
      const nParam3 = reader.readLong();
      reader.readFloat(); // fVal -- __HACK_1023 anti-cheat; unused until inventory ships
      Validate.dword(dwAtkMsg);
      Validate.dword(objid);
      const frame: MeleeAttackFrame = { dwAtkMsg, objid, nParam2, nParam3 };
      const outcome = this.meleeAttackService.attack(player, frame);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'MELEE_ATTACK dropped');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MELEE_ATTACK parse failed');
        return;
      }
      throw error;
    }
  }
}
