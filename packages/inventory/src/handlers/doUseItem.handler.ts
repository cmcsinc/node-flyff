/**
 * DOUSEITEM handler -- `PACKETTYPE_DOUSEITEM` (0x00ff0021).
 *
 * `CDPSrvr::OnDoUseItem` (`DPSrvr.cpp:2601`): `DWORD dwData, OBJID objid,
 * int nPart[, FLOAT fVal]`. The slot is `HIWORD(dwData)`; `objid` is the focus
 * target (NPC for scrolls); a trailing FLOAT rides in only for `PARTS_RIDE`
 * (`__HACK_1023`). Routes via `UseItemService`: equip -> DOEQUIP snapshots;
 * potion/food -> SETPOINTPARAM(DST_HP/MP/FP); buff/skill/warp/text consume the
 * charge (effect ponytail). Every non-equip use also sends UPDATE_ITEM(UI_NUM)
 * for the new stack count (`DoUseItem` tail, MoverSkill.cpp:1723).
 *
 * @module handlers/doUseItem
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { UseItemService } from '../services/useItem.service';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import { buildDoEquipVicinity } from '../net/snapshot/doEquip.serializer';
import { buildSetPointParam, DST_HP, DST_MP, DST_FP } from '@flyff/world-core';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';

const logger = createLogger({ module: 'doUseItem-handler' });
const PARTS_RIDE = 13;

export interface DoUseItemHandlerDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  useItemService: UseItemService;
}

export class DoUseItemHandler {
  constructor(private readonly deps: DoUseItemHandlerDeps) {}

  handleDoUseItem(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    if (player.m_bDead) return;

    try {
      const dwData = reader.readDword();
      reader.readDword();                        // objid -- focus target, unused here
      const nPart = reader.readDword();
      Validate.dword(dwData);
      Validate.dword(nPart);
      if (((dwData >>> 16) & 0xffff) === PARTS_RIDE || nPart === PARTS_RIDE) reader.readFloat();

      // HIWORD(dwData) is the item's STABLE m_dwObjId (DPClient SendDoUseItem ->
      // MAKELONG(ITYPE_ITEM, m_dwObjId)), NOT the current slot -- resolve via scan
      // (mirrors DOEQUIP / C++ GetAtId). Treating it as a slot breaks after the
      // first equip/unequip when objid != current slot.
      const objid = (dwData >>> 16) & 0xffff;
      const slot = player.findSlotByObjId(objid);
      if (slot < 0) { logger.debug({ charId: player.m_idPlayer, objid, nPart }, 'DOUSEITEM item not found by objid'); return; }

      const r = this.deps.useItemService.use(player, slot, nPart);
      if (r.kind === 'equip') {
        const e = r.equip;
        if (!e.ok) { logger.debug({ charId: player.m_idPlayer, slot, nPart, reason: e.reason }, 'DOUSEITEM equip rejected'); return; }
        // 6-field vicinity format, sent to self + peers alike (C++ g_UserMng::
        // AddDoEquip broadcasts to m_2pc incl self -- User.cpp:4515). The 3-field
        // self variant is dead C++ (CUser::AddDoEquip) whose layout desyncs
        // OnDoEquip's 6-field reader.
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildDoEquipVicinity(player.m_idPlayer, e.objid, true, { dwId: e.itemId, nOption: 0, byFlag: 0 }, e.parts),
        );
      } else if (r.kind === 'consumable') {
        if (r.hp !== undefined) this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_HP, r.hp));
        if (r.mp !== undefined) this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_MP, r.mp));
        if (r.fp !== undefined) this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_FP, r.fp));
        // C++ DoUseItem tail: pItemElem->UseItem() then UpdateItem(dwId, UI_NUM,
        // m_nItemNum) on every non-equip use (MoverSkill.cpp:1710/1723). Without
        // this the client never sees the stack drop, so a consume looks like
        // nothing happened. remaining=0 removes the slot client-side.
        this.deps.playerManager.sendTo(player, buildUpdateItemCount(player.m_idPlayer, r.nId, r.remaining));
      } else if (r.kind === 'consumed') {
        this.deps.playerManager.sendTo(player, buildUpdateItemCount(player.m_idPlayer, r.nId, r.remaining));
      } else if (r.kind === 'reject') {
        logger.debug({ charId: player.m_idPlayer, slot, nPart }, 'DOUSEITEM rejected (no equip_slot / unknown kind)');
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'DOUSEITEM parse failed');
        return;
      }
      throw error;
    }
  }
}
