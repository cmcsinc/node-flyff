/**
 * MOVEITEM handler -- `PACKETTYPE_MOVEITEM` (0x00ff0006).
 *
 * `CDPSrvr::OnMoveItem` (`DPSrvr.cpp:787`): `BYTE nItemType, BYTE nSrcIndex,
 * BYTE nDstIndex`. v19 is a pure slot swap (no split opcode). The client does
 * NOT swap optimistically -- `OnDropIcon` sends `SendMoveItem` and waits; the
 * server validates bounds + persists, then echoes `AddMoveItem`
 * (`SNAPSHOTTYPE_MOVEITEM`), which is the only thing that triggers the
 * client-side `m_Inventory.Swap` (`DPClient.cpp:2141`). A rejected move sends
 * no echo, so the item stays put client-side (matches C++ which only echoes on
 * success).
 *
 * @module handlers/moveItem
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { InventoryService } from '../services/inventory.service';
import { MAX_INVENTORY } from '@flyff/world-core';
import { buildMoveItem } from '../net/snapshot/moveItem.serializer';

const logger = createLogger({ module: 'moveItem-handler' });

export interface MoveItemHandlerDeps {
  playerManager: PlayerManager;
  inventoryService: InventoryService;
}

export class MoveItemHandler {
  constructor(private readonly deps: MoveItemHandlerDeps) {}

  handleMoveItem(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const charId = socket.session.charId;
    if (charId === undefined) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(charId);
    if (!player) { socket.destroy(); return; }

    try {
      reader.readByte();                 // nItemType -- unused
      const nSrc = reader.readByte();
      const nDst = reader.readByte();
      Validate.slot(nSrc, MAX_INVENTORY);
      Validate.slot(nDst, MAX_INVENTORY);
      const r = this.deps.inventoryService.moveItem(player, nSrc, nDst);
      if (!r.ok) {
        logger.debug({ charId: player.m_idPlayer, nSrc, nDst }, 'MOVEITEM rejected');
        return;
      }
      this.deps.playerManager.sendTo(player, buildMoveItem(player.m_idPlayer, nSrc, nDst));
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'MOVEITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
