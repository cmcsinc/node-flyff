/**
 * REVIVAL / REVIVAL_TO_LODESTAR / REVIVAL_TO_LODELIGHT handlers.
 *
 * Mirror `DPSrvr::OnRevival` / `OnRevivalLodestar` / `OnRevivalLodelight`
 * (DPSrvr.cpp:960/1061/1188). All three read no body -- the opcode alone selects
 * the revival branch. Lodelight is a C++ empty stub; rejected with a warn.
 *
 * Also carries the two other-player Resurrection answer opcodes
 * (`OnResurrectionOK` / `OnResurrectionCancel`, DPSrvr.cpp:6877/6868), which are
 * likewise bodyless.
 *
 * @module handlers/revival.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { RevivalService, RevivalType } from '../services/revival.service';

const logger = createLogger({ module: 'revival-handler' });

export class RevivalHandler {
  constructor(
    private playerManager: PlayerManager,
    private revivalService: RevivalService,
  ) {}

  /** Dispatch helper -- guards session + player existence, forwards to the service. */
  private revive(socket: ClientSocket, type: RevivalType): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return; }

    const outcome = this.revivalService.revive(player, type);
    if (!outcome.ok) {
      logger.warn({ charId: player.m_idPlayer, type }, `REVIVAL rejected: ${outcome.reason}`);
    }
  }

  /** `OnRevival` (0x00ff00c0) -- scroll revive in place. */
  handleRevival(socket: ClientSocket, _reader: PacketReader): void {
    this.revive(socket, 'SCROLL');
  }

  /** `OnRevivalLodestar` (0x00ff00c1) -- town revive with exp penalty + teleport. */
  handleRevivalLodestar(socket: ClientSocket, _reader: PacketReader): void {
    this.revive(socket, 'LODESTAR');
  }

  /** `OnRevivalLodelight` (0x00ff00c2) -- C++ empty stub. Rejected. */
  handleRevivalLodelight(socket: ClientSocket, _reader: PacketReader): void {
    this.revive(socket, 'LODELIGHT');
  }

  /**
   * `OnResurrectionOK` (0xffffff78) / `OnResurrectionCancel` (0xffffff79) --
   * `CWndResurrectionConfirm`'s two buttons (`_Interface/WndField.cpp:14840`).
   * Both read ZERO body fields; the acting player is the dead one who holds the
   * offer, taken from the session. Refusals are silent on the wire in C++ too
   * (`DPSrvr.cpp:6868/6877` just return), so we only log.
   */
  private answerResurrection(socket: ClientSocket, accept: boolean): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return; }

    const outcome = accept
      ? this.revivalService.acceptResurrection(player)
      : this.revivalService.cancelResurrection(player);
    if (!outcome.ok) {
      logger.warn(
        { charId: player.m_idPlayer, accept },
        `RESURRECTION rejected: ${outcome.reason}`,
      );
    }
  }

  /** `OnResurrectionOK` (0xffffff78) -- accept the pending offer. */
  handleResurrectionOk(socket: ClientSocket, _reader: PacketReader): void {
    this.answerResurrection(socket, true);
  }

  /** `OnResurrectionCancel` (0xffffff79) -- decline; stay dead. */
  handleResurrectionCancel(socket: ClientSocket, _reader: PacketReader): void {
    this.answerResurrection(socket, false);
  }
}
