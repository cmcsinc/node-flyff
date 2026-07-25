/**
 * REMOVEINVENITEM handler -- `PACKETTYPE_REMOVEINVENITEM` (0x00ff0019).
 *
 * `CDPSrvr::OnRemoveInvenItem` (`DPSrvr.cpp:8350`): `DWORD dwId, int nNum`.
 * `dwId` is the inventory elem objid -- in our model the elem objid IS its
 * slot index (mirrors {@link DropItemHandler}). Destroys `nNum` from the slot;
 * no ground pile is spawned. Acks UPDATE_ITEM with the post-remove count
 * (0 clears the slot client-side). Rejected paths send nothing, matching the
 * C++ silent `return`. ponytail: DEFINEDTEXT TID_GAME_CANNOT_DO_USINGITEM /
 * SUCCESS_REMOVE_TEXT -- add when the text frame ships.
 *
 * @module handlers/removeItem
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { InventoryService } from '../services/inventory.service';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';

const logger = createLogger({ module: 'removeItem-handler' });

export interface RemoveItemHandlerDeps {
  playerManager: PlayerManager;
  inventoryService: InventoryService;
}

export class RemoveItemHandler {
  constructor(private readonly deps: RemoveItemHandlerDeps) {}

  handleRemoveItem(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const dwId = reader.readDword();        // inv elem objid (= slot index)
      const nNum = reader.readDword();        // C++ `int nNum` -- 4-byte DWORD
      Validate.dword(dwId);

      const r = this.deps.inventoryService.removeItem(player, dwId, nNum);
      if (!r.ok) { logger.debug({ charId: player.m_idPlayer, dwId, nNum }, 'REMOVEINVENITEM rejected'); return; }

      // nId = STABLE m_dwObjId (client GetAtId, Mover.cpp:8528), NOT the slot.
      // `dwId` is the wire objid; echoing r.slot strands the icon post-move.
      this.deps.playerManager.sendTo(player, buildUpdateItemCount(player.m_idPlayer, dwId, r.remaining));
      logger.info({ charId: player.m_idPlayer, itemId: r.itemId, slot: r.slot, remaining: r.remaining }, 'REMOVEINVENITEM ok');
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'REMOVEINVENITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
