/**
 * Campus handlers -- the 4 client-facing opcodes.
 *
 * `WORLDSERVER/DPSrvr.cpp:540-543` registers only these four; ALL /
 * ADD_MEMBER / UPDATE_POINT are DB-server->world packets registered separately
 * in `DPDatabaseClient.cpp:224-227`, not client packets. `CAMPUS_REMOVE_MEMBER`
 * (0x88100125) is overloaded across both routes with DIFFERENT payloads -- the
 * client form is a single `u_long idTarget`, the DB form is
 * `u_long idCampus, u_long idPlayer`. Only the client form belongs here.
 *
 * All four bodies carry `u_long` PLAYER ids, not objids
 * (`Neuz/DPClient.cpp:19208-19231` send `idTarget` / `idRequest`).
 *
 * @module social/handlers/campus.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { CampusService } from '../services/campus.service';

const logger = createLogger({ module: 'campus-handler' });

export class CampusHandler {
  constructor(
    private playerManager: PlayerManager,
    private campusService: CampusService,
  ) {}

  /** CAMPUS_INVITE -- `u_long idTarget`. */
  handleInvite(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const targetId = reader.readDword();
      Validate.dword(targetId);
      const out = this.campusService.invite(player, targetId);
      logger.debug({ charId: player.m_idPlayer, targetId, out }, 'CAMPUS_INVITE');
    } catch (error) {
      this.onParseError(error, player, 'CAMPUS_INVITE');
    }
  }

  /** CAMPUS_ACCEPT -- `u_long idRequest`. */
  handleAccept(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const requesterId = reader.readDword();
      Validate.dword(requesterId);
      void this.campusService.accept(player, requesterId)
        .then((out) => logger.debug({ charId: player.m_idPlayer, requesterId, out }, 'CAMPUS_ACCEPT'))
        .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'CAMPUS_ACCEPT failed'));
    } catch (error) {
      this.onParseError(error, player, 'CAMPUS_ACCEPT');
    }
  }

  /** CAMPUS_REFUSE -- `u_long idRequest`. */
  handleRefuse(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const requesterId = reader.readDword();
      Validate.dword(requesterId);
      const out = this.campusService.refuse(player, requesterId);
      logger.debug({ charId: player.m_idPlayer, requesterId, out }, 'CAMPUS_REFUSE');
    } catch (error) {
      this.onParseError(error, player, 'CAMPUS_REFUSE');
    }
  }

  /** CAMPUS_REMOVE_MEMBER (client form) -- `u_long idTarget`. */
  handleRemoveMember(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const targetId = reader.readDword();
      Validate.dword(targetId);
      void this.campusService.removeMember(player, targetId)
        .then((out) => logger.debug({ charId: player.m_idPlayer, targetId, out }, 'CAMPUS_REMOVE_MEMBER'))
        .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'CAMPUS_REMOVE_MEMBER failed'));
    } catch (error) {
      this.onParseError(error, player, 'CAMPUS_REMOVE_MEMBER');
    }
  }

  private resolve(socket: ClientSocket): CPlayer | undefined {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return undefined; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return undefined; }
    return player;
  }

  private onParseError(error: unknown, player: CPlayer, label: string): void {
    if (error instanceof PacketError) {
      logger.warn({ err: error, charId: player.m_idPlayer }, `${label} parse failed`);
      return;
    }
    throw error;
  }
}
