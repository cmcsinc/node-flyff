/**
 * MOVEITEM handler -- `PACKETTYPE_MOVEITEM` (0x00ff0006).
 *
 * `CDPSrvr::OnMoveItem` (`DPSrvr.cpp:787`): `BYTE nItemType, BYTE nSrcIndex,
 * BYTE nDstIndex`. v15 is a pure slot swap (no split opcode). The client moves
 * the item optimistically on drag; the server validates bounds + persists. No
 * reply snapshot -- the client already shows the new order, and the JOIN
 * serializer reflects it on relog. Bounds reject is logged + dropped.
 *
 * ponytail: server-authoritative echo (`AddMoveItem`) if anti-cheat or peer-bag
 * sync ever needs it.
 *
 * @module handlers/moveItem
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { InventoryService } from '../services/inventory.service.js';
import { MAX_INVENTORY } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'moveItem-handler' });

export interface MoveItemHandlerDeps {
  playerManager: PlayerManager;
  inventoryService: InventoryService;
}

export class MoveItemHandler {
  constructor(private readonly deps: MoveItemHandlerDeps) {}

  handleMoveItem(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      reader.readByte();                 // nItemType -- unused
      const nSrc = reader.readByte();
      const nDst = reader.readByte();
      Validate.slot(nSrc, MAX_INVENTORY);
      Validate.slot(nDst, MAX_INVENTORY);
      const r = this.deps.inventoryService.moveItem(player, nSrc, nDst);
      if (!r.ok) logger.debug({ charId: player.m_idPlayer, nSrc, nDst }, 'MOVEITEM rejected');
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MOVEITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
