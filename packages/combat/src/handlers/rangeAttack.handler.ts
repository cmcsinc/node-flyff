/**
 * RANGE_ATTACK handler -- `PACKETTYPE_RANGE_ATTACK` (0x00ff0012).
 *
 * `DPSrvr::OnRangeAttack` (DPSrvr.cpp:4296) reads a 4-DWORD body:
 *   `ar >> dwAtkMsg >> objid >> dwItemID >> idSfxHit;`
 * This is NOT the melee body -- melee (`OnMeleeAttack`) reads `dwAtkMsg, objid,
 * nParam2, nParam3, fVal` (5 fields, the last a `__HACK_1023` float). The range
 * packet has no `fVal`. The Neuz send confirms it: `CDPClient::SendRangeAttack`
 * (DPClient.cpp:9852) writes `dwAtkMsg << objid << dwItemID << idSfxHit`.
 *
 * Reading the melee layout here over-runs the 16-byte payload by 4 bytes; the
 * trailing `readFloat()` trips `PacketReader.checkBounds`, throws `PacketError`,
 * and the handler swallows it -- so the swing never reaches the service and
 * ranged damage never lands.
 *
 * `dwItemID` is the bow's item id (passed to `DoAttackRange` for the weapon-type
 * gate); `idSfxHit` is the projectile/hit SFX index. Neither is the melee
 * `nParam2`/`nParam3`. The peer broadcast (`CUserMng::AddRangeAttack`,
 * User.cpp:4846) is a DIFFERENT 5-field shape -- `dwAtkMsg, objid, nParam2,
 * nParam3, idSfxHit` -- remapped at broadcast time (see {@link RangeAttackFrame}).
 *
 * @module handlers/rangeAttack.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
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
    const charId = socket.session.charId;
    if (charId == null) { socket.destroy(); return; }
    const player = this.playerManager.get(charId);
    if (!player) { socket.destroy(); return; }

    // Stunned or sleeping? Ranged attack is an action.
    if (player.m_bDead || player.isStunned()) {
      logger.debug({ charId: player.m_idPlayer, dead: player.m_bDead, stunned: player.isStunned() }, 'RANGE_ATTACK gated');
      return;
    }

    try {
      // 4-DWORD body per DPSrvr.cpp:4298-4303 / DPClient.cpp:9855.
      const dwAtkMsg = reader.readDword();
      const objid = reader.readDword();
      const dwItemID = reader.readDword();
      const idSfxHit = reader.readDword();
      Validate.dword(objid);
      // Broadcast shape per AddRangeAttack (User.cpp:4850): the server remaps
      // the received body -- nParam2 carries dwItemID, nParam3 is hardcoded 0,
      // idSfxHit passes through as a full DWORD (NOT the HIWORD the old code
      // extracted from a non-existent nParam3).
      const frame: RangeAttackFrame = { dwAtkMsg, objid, nParam2: dwItemID, nParam3: 0, idSfxHit };
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
