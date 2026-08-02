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
import { VISIBILITY_RADIUS, FLIGHT_TID } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { PARTS_RIDE } from '@flyff/entities';
import type { ItemDefinition } from '@flyff/resources';
import { buildDoEquipVicinity } from '../net/snapshot/doEquip.serializer';
import { buildSetPointParam, DST_HP, DST_MP, DST_FP } from '@flyff/world-core';
import { buildUpdateItemCount, buildUpdateItemCooltime } from '../net/snapshot/updateItem.serializer';

const logger = createLogger({ module: 'doUseItem-handler' });

export interface DoUseItemHandlerDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  useItemService: UseItemService;
  /** Item prop lookup -- decides whether the `__HACK_1023` float is on the wire. */
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** `__HACK_1023` speed check (`FlightService.isFlightSpeedValid`). */
  isFlightSpeedValid?: (prop: ItemDefinition, claimed: number) => boolean;
  /** Send a `SNAPSHOTTYPE_DEFINEDTEXT` notice to this player (refusal feedback). */
  notify?: (player: CPlayer, tid: number) => void;
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

      // HIWORD(dwData) is the item's STABLE m_dwObjId (DPClient SendDoUseItem ->
      // MAKELONG(ITYPE_ITEM, m_dwObjId)), NOT the current slot -- resolve via scan
      // (mirrors DOEQUIP / C++ GetAtId). Treating it as a slot breaks after the
      // first equip/unequip when objid != current slot.
      const objid = (dwData >>> 16) & 0xffff;
      const slot = player.findSlotByObjId(objid);
      if (slot < 0) { logger.debug({ charId: player.m_idPlayer, objid, nPart }, 'DOUSEITEM item not found by objid'); return; }

      // `__HACK_1023` trailing FLOAT -- read iff the item's OWN dwParts is
      // PARTS_RIDE (`DPSrvr.cpp:2659-2677` resolves the prop first). DOUSEITEM
      // always addresses a bag slot, so the item is never already equipped and
      // the float is always present for a ride item. Keying off the client's
      // `nPart` (the old check) missed every double-click mount, which sends -1.
      const prop = this.deps.getItem(player.m_Inventory[slot]?.itemId ?? 0);
      if (prop?.equip_slot === PARTS_RIDE) {
        const claimed = reader.readFloat();
        if (this.deps.isFlightSpeedValid && !this.deps.isFlightSpeedValid(prop, claimed)) {
          logger.warn(
            { charId: player.m_idPlayer, itemId: prop.id, claimed, expected: prop.flight_speed },
            'DOUSEITEM flight-speed mismatch -- possible client tamper',
          );
          this.deps.notify?.(player, FLIGHT_TID.MODIFY_FLIGHT_SPEED);
          return;
        }
      }
      logger.info({ charId: player.m_idPlayer, objid, slot, nPart, itemId: player.m_Inventory?.[slot]?.itemId }, 'DOUSEITEM recv');

      const r = this.deps.useItemService.use(player, slot, nPart);
      logger.info({ charId: player.m_idPlayer, kind: r.kind, slot, cooltime: 'cooltime' in r ? r.cooltime : undefined, remaining: 'remaining' in r ? r.remaining : undefined }, 'DOUSEITEM result');
      if (r.kind === 'equip') {
        const e = r.equip;
        if (!e.ok) {
          logger.debug({ charId: player.m_idPlayer, slot, nPart, reason: e.reason, tid: e.tid }, 'DOUSEITEM equip rejected');
          if (e.tid !== undefined) this.deps.notify?.(player, e.tid);
          return;
        }
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
        // nothing happened. remaining=0 removes the slot client-side. Grouped
        // items use UI_COOLTIME instead of UI_NUM so the client starts its
        // cooldown sweep (MoverSkill.cpp:1720).
        // nId = STABLE m_dwObjId (client GetAtId, Mover.cpp:8528), NOT the slot
        // (r.nId). `objid` is the wire objid we resolved the slot from; echoing
        // the slot strands the icon when a moved item's objid != slot.
        this.deps.playerManager.sendTo(
          player,
          r.cooltime
            ? buildUpdateItemCooltime(player.m_idPlayer, objid, r.remaining)
            : buildUpdateItemCount(player.m_idPlayer, objid, r.remaining),
        );
      } else if (r.kind === 'consumed') {
        this.deps.playerManager.sendTo(
          player,
          r.cooltime
            ? buildUpdateItemCooltime(player.m_idPlayer, objid, r.remaining)
            : buildUpdateItemCount(player.m_idPlayer, objid, r.remaining),
        );
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
