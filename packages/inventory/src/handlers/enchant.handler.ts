/**
 * ENCHANT handler -- `PACKETTYPE_ENCHANT` (0xf000b024).
 *
 * `CDPSrvr::OnEnchant` (`DPSrvr.cpp:5735`): `DWORD objidTarget,
 * DWORD objidMaterial`. Both are stable `m_dwObjId` values resolved via
 * `findSlotByObjId` (never treated as slots -- a moved item's objid != its
 * current slot). Routes through `EnchantService`, then emits one or more
 * `SNAPSHOTTYPE_UPDATE_ITEM (0x0018)` snapshots per the outcome:
 *   - refine success  -> `UI_AO` (new level)
 *   - element success -> `UI_IR` (element) + `UI_RAO` (level) -- two snapshots
 *   - fail, item kept  -> (target unchanged)
 *   - fail, destroyed  -> `UI_NUM=0` (slot cleared)
 *   - maxed / reject   -> nothing
 *
 * The material slot's count drop is echoed via `UI_NUM` on every consumed
 * outcome (mirrors the `DoUseItem` tail, `MoverSkill.cpp:1723`).
 *
 * ponytail: SFX (`XI_INT_SUCCESS/FAIL`) + sound + defined-text
 * (TID_UPGRADE_SUCCEEFUL/FAIL/MAXOVER) vicinity broadcasts need those
 * serializers -- not wired here.
 *
 * @module handlers/enchant
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { EnchantService } from '../services/enchant.service';
import {
  buildUpdateItemCount, buildUpdateItemElement, buildUpdateItemElementLevel, buildUpdateItemRefine,
} from '../net/snapshot/updateItem.serializer';

const logger = createLogger({ module: 'enchant-handler' });

export interface EnchantHandlerDeps {
  playerManager: PlayerManager;
  enchantService: EnchantService;
}

export class EnchantHandler {
  constructor(private readonly deps: EnchantHandlerDeps) {}

  handleEnchant(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const charId = socket.session.charId;
    if (charId === undefined) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(charId);
    if (!player) { socket.destroy(); return; }
    if (player.m_bDead) return;

    try {
      const targetObjid = reader.readDword();
      const materialObjid = reader.readDword();
      Validate.dword(targetObjid);
      Validate.dword(materialObjid);

      const r = this.deps.enchantService.enchant(player, targetObjid, materialObjid);
      const objid = player.m_idPlayer;

      // UPDATE_ITEM nId MUST be the item's STABLE m_dwObjId, not the slot: client
      // resolves via GetAtId(nId) (Mover.cpp:8528). targetObjid/materialObjid ARE
      // those wire objids; echoing the slot strands the icon when objid != slot.
      // Material stack drop on every consume outcome (success / fail_kept / fail_destroyed).
      if (r.kind === 'refine_success' || r.kind === 'element_success' || r.kind === 'fail_kept' || r.kind === 'fail_destroyed') {
        this.deps.playerManager.sendTo(player, buildUpdateItemCount(objid, materialObjid, r.materialRemaining));
      }

      switch (r.kind) {
        case 'refine_success':
          this.deps.playerManager.sendTo(player, buildUpdateItemRefine(objid, targetObjid, r.newRefine));
          break;
        case 'element_success':
          this.deps.playerManager.sendTo(player, buildUpdateItemElement(objid, targetObjid, r.newElement));
          this.deps.playerManager.sendTo(player, buildUpdateItemElementLevel(objid, targetObjid, r.newLevel));
          break;
        case 'fail_destroyed':
          this.deps.playerManager.sendTo(player, buildUpdateItemCount(objid, targetObjid, 0));
          break;
        case 'fail_kept':
          break;
        case 'maxed':
          logger.debug({ charId: player.m_idPlayer, slot: r.targetSlot }, 'ENCHANT maxed -- no consume');
          break;
        case 'reject':
          logger.debug({ charId: player.m_idPlayer, reason: r.reason }, 'ENCHANT rejected');
          break;
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'ENCHANT parse failed');
        return;
      }
      throw error;
    }
  }
}
