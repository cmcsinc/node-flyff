/**
 * RANGE_ATTACK handler -- `PACKETTYPE_RANGE_ATTACK` (0x00ff0012).
 *
 * The ranged twin of {@link MeleeAttackHandler}. Same C->S body as melee
 * (`dwAtkMsg, objid, nParam2, nParam3` + trailing `fVal` under `__HACK_1023`,
 * active in v19). `fVal` is consumed to keep the stream aligned but otherwise
 * unused (anti-cheat echo of the weapon's fAttackSpeed).
 *
 * The client sends RANGE_ATTACK (not MELEE_ATTACK) when the equipped weapon is a
 * bow, so this is the distinct ranged auto-attack path. `idSfxHit` is derived
 * from `nParam3`'s HIWORD -- the same field the melee snapshot uses to drive the
 * peer hit SFX -- so the ranged echo carries a projectile SFX id.
 *
 * @module handlers/rangeAttack.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { RangeAttackService } from '../services/rangeAttack.service';
import type { RangeAttackFrame } from '../net/snapshot/rangeAttack.serializer';

const logger = createLogger({ module: 'rangeAttack-handler' });

export class RangeAttackHandler {
  constructor(
    private playerManager: PlayerManager,
    private rangeAttackService: RangeAttackService,
  ) {}

  handleRangeAttack(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    // Stunned or sleeping? Ranged attack is an action.
    if (player.m_bDead || player.isStunned()) {
      logger.debug({ charId: player.m_idPlayer, dead: player.m_bDead, stunned: player.isStunned() }, 'RANGE_ATTACK gated');
      return;
    }

    try {
      const dwAtkMsg = reader.readDword();
      const objid = reader.readDword();
      const nParam2 = reader.readLong();
      const nParam3 = reader.readLong();
      reader.readFloat(); // fVal -- __HACK_1023 anti-cheat; unused until enforced
      Validate.dword(dwAtkMsg);
      Validate.dword(objid);
      // HIWORD(nParam3) is the peer hit-SFX id (same field the melee snapshot
      // reads); pass it through as the ranged projectile SFX. >>>0 keeps it an
      // unsigned DWORD for the serializer.
      const idSfxHit = (nParam3 >>> 16) & 0xffff;
      const frame: RangeAttackFrame = { dwAtkMsg, objid, nParam2, nParam3, idSfxHit };
      const outcome = this.rangeAttackService.attack(player, frame);
      if (!outcome.ok) {
        logger.debug({ charId: player.m_idPlayer, reason: outcome.reason }, 'RANGE_ATTACK dropped');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'RANGE_ATTACK parse failed');
        return;
      }
      throw error;
    }
  }
}
