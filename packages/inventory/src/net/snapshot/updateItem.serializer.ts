/**
 * UPDATE_ITEM S->C snapshot -- count/field delta on an EXISTING inventory slot.
 *
 * `CUser::AddUpdateItem` (`WORLDSERVER/User.cpp:1089`):
 * `[objid][SNAPSHOTTYPE_UPDATE_ITEM=0x0018][BYTE cType][BYTE nId][CHAR cParam]
 * [DWORD dwValue][DWORD dwTime]`. Used for stack-count changes on an occupied
 * slot (merge/consume/drop-partial) -- a CREATEITEM is only for a NEW slot.
 *
 * `cType` selects the container (0 = main inventory slot); `nId` is the slot
 * index; `cParam` is the `UI_*` field (Mover.h:62) -- `UI_NUM=0` = stack count;
 * `dwValue` the new value; `dwTime` v15 trailing field (0 here).
 *
 * @module net/snapshot/updateItem
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

/** Container/slot-field codes (`_Common/Mover.h:62`, `UI_*`). */
export const UI_NUM = 0; // stack count
export const UI_COOLTIME = 8; // count + start cooldown sweep (Mover.h:68)

/**
 * Build an UPDATE_ITEM snapshot setting slot `slot`'s count to `count`.
 * `objid` is the player's, `slot` the inventory index.
 */
export function buildUpdateItemCount(objid: number, slot: number, count: number): Buffer {
  return buildUpdateItem(objid, slot, UI_NUM, count);
}

/**
 * Build an UPDATE_ITEM snapshot that also signals a cooldown on `slot`
 * (`UpdateItem(..., UI_COOLTIME, newCount)` -- `MoverSkill.cpp:1720`). The
 * client re-derives the sweep duration from the item's own `dwSkillReady`
 * (`DPClient.cpp:3154`); `dwTime` is unused for cooldown, stays 0.
 */
export function buildUpdateItemCooltime(objid: number, slot: number, count: number): Buffer {
  return buildUpdateItem(objid, slot, UI_COOLTIME, count);
}

function buildUpdateItem(objid: number, slot: number, cParam: number, count: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);                          // cb
  w.writeDword(objid);                     // GetId()
  w.writeWord(SNAPSHOTTYPE.UPDATE_ITEM);   // 0x0018
  w.writeByte(0);                          // cType = inventory slot
  w.writeByte(slot & 0xff);                // nId
  w.writeByte(cParam);                     // UI_NUM / UI_COOLTIME
  w.writeDword(count);                     // dwValue
  w.writeDword(0);                         // dwTime (v15)
  return w.build();
}
