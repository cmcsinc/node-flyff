/**
 * DOUSEITEM handler -- `PACKETTYPE_DOUSEITEM` (0x00ff0021).
 *
 * `CDPSrvr::OnDoUseItem` (`DPSrvr.cpp:2601`): `DWORD dwData, OBJID objid,
 * int nPart[, FLOAT fVal]`. The slot is `HIWORD(dwData)`; `objid` is the focus
 * target (NPC for scrolls); a trailing FLOAT rides in only for `PARTS_RIDE`
 * (`__HACK_1023`). Routes via `UseItemService`: equip -> DOEQUIP snapshots;
 * potion/food -> SETPOINTPARAM(DST_HP/MP/FP); buff/skill/warp/text consume the
 * charge (effect ponytail).
 *
 * @module handlers/doUseItem
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { UseItemService } from '../services/useItem.service.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';
import { buildDoEquipVicinity } from '../net/snapshot/doEquip.serializer.js';
import { buildSetPointParam, DST_HP, DST_MP, DST_FP } from '../net/snapshot/pointParam.serializer.js';

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

      const r = this.deps.useItemService.use(player, dwData, nPart);
      if (r.kind === 'equip') {
        const e = r.equip;
        if (!e.ok) { logger.debug({ charId: player.m_idPlayer, nId: (dwData >>> 16) & 0xffff, nPart, reason: e.reason }, 'DOUSEITEM equip rejected'); return; }
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
      } else if (r.kind === 'reject') {
        logger.debug({ charId: player.m_idPlayer, nId: (dwData >>> 16) & 0xffff, nPart }, 'DOUSEITEM rejected (no equip_slot / unknown kind)');
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
