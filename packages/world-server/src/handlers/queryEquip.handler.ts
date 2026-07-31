/**
 * QUERYEQUIP / QUERYEQUIPSETTING handlers -- 0xf000d009 / 0xf000d00a.
 *
 * `DPSrvr::OnQueryEquip` (DPSrvr.cpp:7128) reads `OBJID objid` -- the player to
 * inspect -- and replies SNAPSHOTTYPE_QUERYEQUIP with that player's per-slot
 * refine/awaken data (the client already has the item ids from ADD_OBJ).
 *
 * `OnQueryEquipSetting` (DPSrvr.cpp:7150) reads `BOOL bAllow` (4 bytes) and
 * flips the `EQUIP_DENIAL_MODE` bit.
 *
 * @module handlers/queryEquip.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { QueryEquipService } from '../services/queryEquip.service';

const logger = createLogger({ module: 'queryEquip-handler' });

export class QueryEquipHandler {
  constructor(
    private playerManager: PlayerManager,
    private queryEquipService: QueryEquipService,
  ) {}

  handleQueryEquip(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;

    let objid: number;
    try {
      objid = reader.readDword();
      Validate.dword(objid);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'QUERYEQUIP parse failed');
        return;
      }
      throw error;
    }

    const out = this.queryEquipService.queryEquip(player, objid);
    logger.debug({ charId: player.m_idPlayer, objid, out }, 'QUERYEQUIP');
  }

  handleQueryEquipSetting(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;

    let allow: boolean;
    try {
      // BOOL is a 4-byte int in the C++ CAr stream, not a byte.
      allow = reader.readDword() !== 0;
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'QUERYEQUIPSETTING parse failed');
        return;
      }
      throw error;
    }

    this.queryEquipService.setAllowInspect(player, allow);
    logger.debug({ charId: player.m_idPlayer, allow }, 'QUERYEQUIPSETTING');
  }

  private resolve(socket: ClientSocket): CPlayer | undefined {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return undefined; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return undefined; }
    return player;
  }
}
