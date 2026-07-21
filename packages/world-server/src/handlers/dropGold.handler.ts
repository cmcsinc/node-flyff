/**
 * DROPGOLD handler — `PACKETTYPE_DROPGOLD` (0x00ff0008).
 *
 * `CDPSrvr::OnDropGold` (`DPSrvr.cpp:841`): `DWORD dwGold, D3DXVECTOR3 vPos`.
 * Removes the penya from `m_nGold` (rejects over-spend) and spawns a gold pile
 * (`II_GOLD_SEED1..4` picked by amount). The pile ADD_OBJ reaches the dropper.
 *
 * @module handlers/dropGold
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
import { goldSeedId } from '../services/drop.service.js';

const logger = createLogger({ module: 'dropGold-handler' });

export interface DropGoldHandlerDeps {
  playerManager: PlayerManager;
  itemManager: ItemManager;
  inventoryService: InventoryService;
}

export class DropGoldHandler {
  constructor(private readonly deps: DropGoldHandlerDeps) {}

  handleDropGold(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const dwGold = reader.readDword();
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();
      Validate.dword(dwGold);
      Validate.pos(x, y, z);

      const r = this.deps.inventoryService.dropGold(player, dwGold, { x, y, z });
      if (!r.ok) { logger.debug({ charId: player.m_idPlayer, dwGold }, 'DROPGOLD rejected'); return; }

      this.deps.itemManager.spawn({
        itemId: goldSeedId(r.amount),
        count: r.amount,
        ownerId: player.m_idPlayer,
        pos: r.pos,
        zoneId: player.m_nZoneId,
      });
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'DROPGOLD parse failed');
        return;
      }
      throw error;
    }
  }
}
