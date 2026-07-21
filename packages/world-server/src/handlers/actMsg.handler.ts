/**
 * ACTMSG handler — `PACKETTYPE_ACTMSG` (0x00ff0001).
 *
 * `CDPClient::SendActMsg` (Neuz/DPClient.cpp:9102) sends
 * `DWORD dwMsg | int nParam1 | int nParam2`. The server dispatches on `dwMsg`
 * (the `OBJMSG_*` enum, MoverMsg.h:105); `OBJMSG_PICKUP(=11)` with
 * `nParam1 = ground-item objid` is the loot request → `CUser::OnMsgArrival`
 * (User.cpp:7040) → `DoLoot`.
 *
 * Pickup (ports `DoLoot`, MoverActEvent.cpp:2575):
 *   1. resolve the pile via `itemManager.get(objid)`;
 *   2. ownership gate — owner or FFA (`IsLoot`, `m_idOwn`);
 *   3. gold seed → `InventoryService.addGold` + `SETPOINTPARAM(DST_GOLD)` self;
 *      else → `addItem` → on ok `CREATEITEM` self, on bag-full leave lootable;
 *   4. `itemManager.remove(objid)` broadcasts `DEL_OBJ` to the vicinity.
 *
 * WAL-first (rule 03/04): the service journals + mutates before this handler
 * sends any ack snapshot.
 *
 * ponytail: party loot-share + 7 s FFA timeout, `TID_GAME_LACKSPACE` defined
 * text on bag-full, other `OBJMSG_*` (resurrect/collect).
 *
 * @module handlers/actMsg
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
import type { CPlayer } from '../entities/player.js';
import { isGoldSeed } from '../services/drop.service.js';
import { CreateItemSnapshotSerializer } from '../net/snapshot/createItem.serializer.js';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer.js';
import { buildSetPointParam, DST_GOLD } from '../net/snapshot/pointParam.serializer.js';
import { NULL_ID } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'actMsg-handler' });

/** `OBJMSG_PICKUP` (`_Common/MoverMsg.h:118`). */
const OBJMSG_PICKUP = 11;

export interface ActMsgHandlerDeps {
  playerManager: PlayerManager;
  itemManager: ItemManager;
  inventoryService: InventoryService;
  /** Injector seam for tests. */
  createItemSerializer?: CreateItemSnapshotSerializer;
}

export class ActMsgHandler {
  private readonly createItemSerializer: CreateItemSnapshotSerializer;
  constructor(private readonly deps: ActMsgHandlerDeps) {
    this.createItemSerializer = deps.createItemSerializer ?? new CreateItemSnapshotSerializer();
  }

  handleActMsg(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const dwMsg = reader.readDword();
      const nParam1 = reader.readDword();
      reader.readDword(); // nParam2 — kept aligned; unused for pickup
      Validate.dword(dwMsg);
      Validate.dword(nParam1);

      if (dwMsg === OBJMSG_PICKUP) this.pickup(player, nParam1);
      // other OBJMSG_* (resurrect/collect/...) deferred
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'ACTMSG parse failed');
        return;
      }
      throw error;
    }
  }

  /** `DoLoot` for `OBJMSG_PICKUP` — validate ownership, route gold vs item. */
  private pickup(player: CPlayer, objid: number): void {
    const item = this.deps.itemManager.get(objid);
    if (!item) return;

    // Ownership: FFA (NULL_ID) or the recorded owner. ponytail: party-share + 7 s FFA timeout.
    if (item.m_idOwn !== NULL_ID && item.m_idOwn !== player.m_idPlayer) return;

    if (isGoldSeed(item.m_dwItemId)) {
      this.deps.inventoryService.addGold(player, item.m_nItemNum);
      this.deps.playerManager.sendTo(
        player,
        buildSetPointParam(player.m_idPlayer, DST_GOLD, player.m_nGold),
      );
      this.deps.itemManager.remove(objid); // broadcasts DEL_OBJ to vicinity
      return;
    }

    const r = this.deps.inventoryService.addItem(player, item.m_dwItemId, item.m_nItemNum);
    if (!r.ok) return; // bag_full — ponytail: TID_GAME_LACKSPACE; pile stays lootable

    // isNew slot → CREATEITEM; stack-merge onto an existing slot → UPDATE_ITEM.
    this.deps.playerManager.sendTo(
      player,
      r.isNew
        ? this.createItemSerializer.buildOne(player.m_idPlayer, r.itemId, r.count, r.slot)
        : buildUpdateItemCount(player.m_idPlayer, r.slot, r.count),
    );
    this.deps.itemManager.remove(objid);
  }
}
