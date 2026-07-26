/**
 * Duel C->S handlers -- `PACKETTYPE_DUELREQUEST/DUELYES/DUELNO` (0xffffff23-25).
 *
 * `CDPClient::SendDuelRequest/Yes/No` (Neuz/DPClient.cpp:9565/9573/9581) send
 * the player's own objid as `uidSrc` (DuelYes also echoes `uidDst`). The server
 * re-derives both peers from the live `PlayerManager` -- client-sent ids are
 * validated against the socket's session, never trusted for routing.
 *
 *   REQUEST `u_long uidSrc, u_long uidDst`  -- A challenges B (= uidDst)
 *   YES     `u_long uidSrc, u_long uidDst`  -- B accepts A's pending proposal
 *   NO      `u_long uidSrc`                  -- B declines (or cancel outbound)
 *
 * Guards (rule 03): session IN_WORLD, player resolves, uidSrc matches session
 * charId. Delegates the state machine to {@link DuelService}.
 *
 * @module handlers/duel
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { DuelService } from '../services/duel.service';

const logger = createLogger({ module: 'duel-handler' });

export interface DuelHandlerDeps {
  playerManager: PlayerManager;
  duelService: DuelService;
}

export class DuelHandler {
  constructor(private readonly deps: DuelHandlerDeps) {}

  handleDuelRequest(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      const uidSrc = reader.readDword();
      const uidDst = reader.readDword();
      if (uidSrc !== player.m_idPlayer) return; // forged src
      this.deps.duelService.request(player, uidDst);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'DUELREQUEST parse failed'); return; }
      throw error;
    }
  }

  handleDuelYes(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      // YES body: `u_long uidSrc(=challenger A) | u_long uidDst(=self B)`.
      // Validate uidDst is the session player (anti-forgery); pass A's id as
      // srcId so the service resolves pending(dst=B) and matches srcId===A.
      const uidSrc = reader.readDword();
      const uidDst = reader.readDword();
      if (uidDst !== player.m_idPlayer) return;
      this.deps.duelService.accept(player, uidSrc);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'DUELYES parse failed'); return; }
      throw error;
    }
  }

  handleDuelNo(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      const uidSrc = reader.readDword();
      if (uidSrc !== player.m_idPlayer) return;
      // DUELNO body carries only uidSrc (= self). The challenged target's
      // inbound proposal is a single slot on the DuelManager; resolve there.
      this.deps.duelService.declineByTarget(player);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'DUELNO parse failed'); return; }
      throw error;
    }
  }
}
