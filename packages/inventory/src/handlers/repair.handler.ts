/**
 * RepairItem handler -- `PACKETTYPE_REPAIRITEM` (0x00ff00b5).
 *
 * `CDPClient::SendRepairItem` (Neuz/DPClient.cpp:14241) sends
 * `BYTE c | c × BYTE nId` -- a count of inventory slot ids to bulk-repair. The
 * server caps `c` at `MAX_REPAIRINGITEM` (25, `_Common/ProjectCmn.h`). On
 * success the handler emits one `UPDATE_ITEM` snapshot per repaired slot so
 * the client redraws each durability bar; on `insufficient_gold` / `empty`
 * it sends nothing (the client keeps its prior state).
 *
 * WAL-first (rule 03/04): {@link RepairService} journals each slot's absolute
 * end-state BEFORE this handler sends any ack snapshot.
 *
 * @module handlers/repair
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { RepairService } from '../services/repair.service';
import { buildUpdateItemDurability } from '../net/snapshot/updateItem.serializer';

const logger = createLogger({ module: 'repair-handler' });

/** `_Common/ProjectCmn.h` -- max slots per bulk-repair request. */
const MAX_REPAIRINGITEM = 25;

export interface RepairHandlerDeps {
  playerManager: PlayerManager;
  repairService: RepairService;
}

export class RepairHandler {
  constructor(private readonly deps: RepairHandlerDeps) {}

  handleRepair(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }

    try {
      const count = reader.readByte();
      if (count === 0 || count > MAX_REPAIRINGITEM) return; // ignore bogus
      const slots: number[] = [];
      for (let i = 0; i < count; i++) slots.push(reader.readByte());

      const r = this.deps.repairService.repair(player, slots);
      if (!r.ok) return;
      for (const s of r.repaired!) {
        this.deps.playerManager.sendTo(
          player,
          buildUpdateItemDurability(player.m_idPlayer, s.objid, s.durability),
        );
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'REPAIRITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
