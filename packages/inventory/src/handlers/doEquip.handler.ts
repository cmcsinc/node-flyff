/**
 * DOEQUIP handler -- `PACKETTYPE_DOEQUIP` (0x00ff000b).
 *
 * `CDPSrvr::OnDoEquip` (`DPSrvr.cpp:735`): `DWORD nId, int nPart[, FLOAT fVal]`.
 * `nId` is the item's STABLE `m_dwObjId` (client `SendDoEquip`, DPClient.cpp:9201);
 * `nPart` is the equip slot (1..30), or -1 (client default for double-click /
 * drag-drop) meaning "resolve from the item's own dwParts". Equip-vs-unequip is decided
 * like C++ `IsEquip(nId)` (Item.h:599) -- by whether the item currently sits in
 * an equip slot -- NOT by the nId value, because the objid is stable and does
 * not change when the item moves between bag and equip slots. A trailing FLOAT
 * is sent only for `PARTS_RIDE(13)` items (`__HACK_1023` board-speed anti-cheat);
 * RIDE is rejected, the float is still consumed to keep the stream aligned.
 *
 * On success: one vicinity DOEQUIP (6-field) broadcast to self + peers. Self
 * needs it to move the item client-side (`OnDoEquip` IsActiveMover path does
 * `GetAtId(nId)` then the `DoEquip` worker relocates the item); peers render
 * the weapon/armor on the body.
 *
 * @module handlers/doEquip
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { EquipService } from '../services/equip.service';
import { MAX_INVENTORY, VISIBILITY_RADIUS } from '@flyff/world-core';
import { buildDoEquipVicinity } from '../net/snapshot/doEquip.serializer';

const logger = createLogger({ module: 'doEquip-handler' });
const PARTS_RIDE = 13;

export interface DoEquipHandlerDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  equipService: EquipService;
}

export class DoEquipHandler {
  constructor(private readonly deps: DoEquipHandlerDeps) {}

  handleDoEquip(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    if (player.m_bDead) return;

    try {
      const nId = reader.readDword();
      const nPartRaw = reader.readDword();
      Validate.dword(nId);
      // C++ reads `int nPart` (signed 4 bytes, DPSrvr.cpp:735). Coerce to
      // signed int32 BEFORE validating range so 0xffffffff → -1 is handled
      // correctly. Valid values: -1 (auto-resolve from dwParts) or 0..30
      // (PARTS_* slots, `_Common/Item.h:548`).
      const nPart = nPartRaw | 0;
      if (nPart !== -1 && (nPart < 0 || nPart > 30)) {
        throw new PacketError('DOEQUIP invalid nPart');
      }
      if (nPart === PARTS_RIDE) reader.readFloat(); // __HACK_1023 trailing float -- consume + reject below

      // Client sends the item's STABLE m_dwObjId (DPClient.cpp:9201 SendDoEquip).
      // It does not change across equip/unequip/move (C++ UnEquip only remaps
      // m_apIndex/m_dwObjIndex, Item.h:571). Our flat array relocates items on
      // equip, so resolve the objid -> current slot, then discriminate by slot
      // range like C++ IsEquip(nId) (Item.h:599: m_dwObjIndex >= MAX_INVENTORY).
      // Discriminating by nId>=MAX_INVENTORY breaks for session-equipped items:
      // their objid is the original BAG slot, so the client sends nId<MAX_INVENTORY
      // for an equipped item and we'd misroute to equip + reject (nothing happens).
      const idx = player.findSlotByObjId(nId);
      if (idx < 0) { logger.debug({ charId: player.m_idPlayer, nId, nPart }, 'DOEQUIP item not found by objid'); return; }

      // Wire nId = the stable objid (echo nId). OnDoEquip's self-path resolves the
      // item via GetAtId(nId) then its DoEquip worker relocates it client-side.
      if (idx >= MAX_INVENTORY) {
        const r = this.deps.equipService.unequip(player, idx - MAX_INVENTORY);
        if (!r.ok) { logger.debug({ charId: player.m_idPlayer, nId, nPart }, 'DOEQUIP unequip rejected'); return; }
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildDoEquipVicinity(player.m_idPlayer, nId, false, { dwId: r.itemId, nOption: 0, byFlag: 0 }, r.parts),
        );
      } else {
        const r = this.deps.equipService.equip(player, idx, nPart);
        if (!r.ok) { logger.debug({ charId: player.m_idPlayer, nId, nPart }, 'DOEQUIP equip rejected'); return; }
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildDoEquipVicinity(player.m_idPlayer, nId, true, { dwId: r.itemId, nOption: 0, byFlag: 0 }, r.parts),
        );
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'DOEQUIP parse failed');
        return;
      }
      throw error;
    }
  }
}
