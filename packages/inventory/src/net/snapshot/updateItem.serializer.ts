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

/**
 * Build an UPDATE_ITEM snapshot setting slot `slot`'s count to `count`.
 * `objid` is the player's, `slot` the inventory index.
 */
export function buildUpdateItemCount(objid: number, slot: number, count: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);                          // cb
  w.writeDword(objid);                     // GetId()
  w.writeWord(SNAPSHOTTYPE.UPDATE_ITEM);   // 0x0018
  w.writeByte(0);                          // cType = inventory slot
  w.writeByte(slot & 0xff);                // nId
  w.writeByte(UI_NUM);                     // cParam = count
  w.writeDword(count);                     // dwValue
  w.writeDword(0);                         // dwTime (v15)
  return w.build();
}
