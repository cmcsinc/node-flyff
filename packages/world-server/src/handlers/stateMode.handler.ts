/**
 * StateModeHandler -- `PACKETTYPE_STATEMODE` (0xffffff7a).
 *
 * `CDPSrvr::OnStateMode` (`WORLDSERVER/DPSrvr.cpp:6844`): `DWORD dwStateMode,
 * BYTE nFlag`. The client's only use is aborting an armed item channel -- it
 * sends `STATE_BASEMOTION_MODE | STATEMODE_BASEMOTION_CANCEL` on click-move,
 * WASD, jump (`WndWorldControlPlayer.cpp:560`) and on taking or dealing a hit
 * (`Neuz/DPClient.cpp:1827`). C++ requires the player to actually be in the
 * claimed state (`pUser->IsStateMode( dwStateMode )`) and ignores every flag but
 * CANCEL, so a client cannot use this to force a channel to *complete*.
 *
 * The peer broadcast is suppressed: the cancelling client has already dropped
 * its own cast bar locally, and echoing CANCEL back re-enters `OnStateMode`
 * client-side. C++ does re-broadcast (via `SetStateNotMode`), but its client
 * tolerates the echo because the state is already clear -- ours matches the
 * observable behaviour without the extra frame.
 *
 * @module handlers/stateMode.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import { STATE_BASEMOTION_MODE, STATEMODE } from '@flyff/world-core';
import type { BlinkwingService } from '@flyff/inventory';

const logger = createLogger({ module: 'stateMode-handler' });

export class StateModeHandler {
  constructor(
    private readonly playerManager: PlayerManager,
    private readonly blinkwingService: BlinkwingService,
  ) {}

  handleStateMode(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const charId = socket.session.charId;
    const player = charId === undefined ? undefined : this.playerManager.get(charId);
    if (!player) { socket.destroy(); return; }

    try {
      const dwStateMode = reader.readDword();
      const nFlag = reader.readByte();
      Validate.dword(dwStateMode);
      if (nFlag !== STATEMODE.BASEMOTION_CANCEL) return;
      // C++ `IsStateMode( dwStateMode )` -- the claimed bits must be set.
      if ((dwStateMode & STATE_BASEMOTION_MODE) === 0) return;
      if ((player.m_dwStateMode & dwStateMode) !== dwStateMode) return;
      this.blinkwingService.cancel(player, false);
      logger.debug({ charId: player.m_idPlayer }, 'STATEMODE cancel');
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'STATEMODE parse failed');
        return;
      }
      throw error;
    }
  }
}
