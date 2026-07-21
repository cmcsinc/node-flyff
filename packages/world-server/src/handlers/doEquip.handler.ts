/**
 * DOEQUIP handler — `PACKETTYPE_DOEQUIP` (0x00ff000b).
 *
 * `CDPSrvr::OnDoEquip` (`DPSrvr.cpp:735`): `DWORD nId, int nPart[, FLOAT fVal]`.
 * `nId` is the inventory elem objid (our slot index); `nPart` is the equip slot
 * (1..30) to equip into, or — when `nId` already points at an equipped slot —
 * the implicit unequip. A trailing FLOAT is sent only for `PARTS_RIDE(13)`
 * items (`__HACK_1023` board-speed anti-cheat); RIDE is rejected, the float is
 * still consumed to keep the stream aligned.
 *
 * On success: self-confirm DOEQUIP to the equipper + vicinity DOEQUIP so peers
 * render the weapon/armor on the body.
 *
 * @module handlers/doEquip
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { EquipService } from '../services/equip.service.js';
import { MAX_INVENTORY, VISIBILITY_RADIUS } from '../net/snapshot/constants.js';
import { buildDoEquipSelf, buildDoEquipVicinity } from '../net/snapshot/doEquip.serializer.js';

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
      const nPart = reader.readDword();
      Validate.dword(nId);
      Validate.dword(nPart);
      if (nPart === PARTS_RIDE) reader.readFloat(); // __HACK_1023 trailing float — consume + reject below

      // nId in the equip range ⇒ unequip that part; main-bag nId ⇒ equip into nPart.
      if (nId >= MAX_INVENTORY) {
        const r = this.deps.equipService.unequip(player, nId - MAX_INVENTORY);
        if (!r.ok) { logger.debug({ charId: player.m_idPlayer, nId, nPart }, 'DOEQUIP unequip rejected'); return; }
        this.deps.playerManager.sendTo(player, buildDoEquipSelf(player.m_idPlayer, r.invSlot, r.itemId, false));
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildDoEquipVicinity(player.m_idPlayer, r.invSlot, false, { dwId: 0, nOption: 0, byFlag: 0 }, r.parts),
          player,
        );
      } else {
        const r = this.deps.equipService.equip(player, nId, nPart);
        if (!r.ok) { logger.debug({ charId: player.m_idPlayer, nId, nPart }, 'DOEQUIP equip rejected'); return; }
        this.deps.playerManager.sendTo(player, buildDoEquipSelf(player.m_idPlayer, r.invSlot, r.itemId, true));
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildDoEquipVicinity(player.m_idPlayer, r.invSlot, true, { dwId: r.itemId, nOption: 0, byFlag: 0 }, r.parts),
          player,
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
