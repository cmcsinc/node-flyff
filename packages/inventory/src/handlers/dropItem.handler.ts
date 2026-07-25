/**
 * DROPITEM handler -- `PACKETTYPE_DROPITEM` (0x00ff0007).
 *
 * `CDPSrvr::OnDropItem` (`DPSrvr.cpp:813`): `DWORD dwItemType, DWORD dwItemId,
 * short nDropNum, D3DXVECTOR3 vPos(3 floats)`. `dwItemId` is the inventory
 * elem's STABLE `m_dwObjId` (set at JOIN/pickup, preserved across move) -- NOT
 * the current slot, so resolve via `findSlotByObjId` (mirrors DOEQUIP /
 * DOUSEITEM; treating it as a slot removes the wrong slot after any MOVEITEM).
 * Removes the count from the bag, spawns a ground pile at `vPos` (ADD_OBJ
 * vicinity), AND echoes UPDATE_ITEM with the post-drop count so the client
 * clears the slot -- the client spawns the pile on the ADD_OBJ broadcast but
 * does NOT remove the inventory item optimistically, so omitting the echo
 * leaves the slot populated client-side = item dupe.
 *
 * @module handlers/dropItem
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { ItemManager } from '../managers/item.manager';
import type { InventoryService } from '../services/inventory.service';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';

const logger = createLogger({ module: 'dropItem-handler' });

export interface DropItemHandlerDeps {
  playerManager: PlayerManager;
  itemManager: ItemManager;
  inventoryService: InventoryService;
}

export class DropItemHandler {
  constructor(private readonly deps: DropItemHandlerDeps) {}

  handleDropItem(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      reader.readDword();                        // dwItemType -- unused
      const dwItemId = reader.readDword();       // inv elem m_dwObjId (stable)
      const nDropNum = reader.readWord();
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();
      Validate.dword(dwItemId);
      Validate.pos(x, y, z);

      const slot = player.findSlotByObjId(dwItemId);
      if (slot < 0) { logger.debug({ charId: player.m_idPlayer, dwItemId }, 'DROPITEM item not found by objid'); return; }

      const r = this.deps.inventoryService.dropItem(player, slot, nDropNum, { x, y, z });
      if (!r.ok) { logger.debug({ charId: player.m_idPlayer, dwItemId, slot }, 'DROPITEM rejected'); return; }

      this.deps.itemManager.spawn({
        itemId: r.itemId,
        count: r.count,
        ownerId: player.m_idPlayer,
        pos: r.pos,
        zoneId: player.m_nZoneId,
      });
      // Echo the post-drop count so the client clears the slot (0 => removed).
      // Without this the pile spawns but the inventory item stays = dupe.
      // nId = the STABLE m_dwObjId (client resolves via GetAtId, Mover.cpp:8528),
      // NOT the slot -- a moved item's objid != slot, so echoing r.slot leaves
      // the icon stuck. `dwItemId` is that wire objid.
      this.deps.playerManager.sendTo(player, buildUpdateItemCount(player.m_idPlayer, dwItemId, r.remaining));
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'DROPITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
