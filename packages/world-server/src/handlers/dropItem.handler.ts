/**
 * DROPITEM handler -- `PACKETTYPE_DROPITEM` (0x00ff0007).
 *
 * `CDPSrvr::OnDropItem` (`DPSrvr.cpp:813`): `DWORD dwItemType, DWORD dwItemId,
 * short nDropNum, D3DXVECTOR3 vPos(3 floats)`. `dwItemId` is the inventory
 * elem's objid -- in our model the elem objid IS its slot index. Removes the
 * count from the bag and spawns a ground pile at `vPos` (ADD_OBJ vicinity).
 * The client drops optimistically; the pile broadcast reaches the dropper too.
 *
 * @module handlers/dropItem
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ItemManager } from '../managers/item.manager.js';
import type { InventoryService } from '../services/inventory.service.js';

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
      const dwItemId = reader.readDword();       // inv elem objid (= slot index)
      const nDropNum = reader.readWord();
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();
      Validate.dword(dwItemId);
      Validate.pos(x, y, z);

      const r = this.deps.inventoryService.dropItem(player, dwItemId, nDropNum, { x, y, z });
      if (!r.ok) { logger.debug({ charId: player.m_idPlayer, dwItemId }, 'DROPITEM rejected'); return; }

      this.deps.itemManager.spawn({
        itemId: r.itemId,
        count: r.count,
        ownerId: player.m_idPlayer,
        pos: r.pos,
        zoneId: player.m_nZoneId,
      });
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'DROPITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
