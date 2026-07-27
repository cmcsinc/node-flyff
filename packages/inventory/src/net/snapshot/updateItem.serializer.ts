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
 * `dwValue` the new value; `dwTime` v19 trailing field (0 here).
 *
 * @module net/snapshot/updateItem
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

/** Container/slot-field codes (`_Common/Mover.h:62`, `UI_*`). */
export const UI_NUM = 0; // stack count
export const UI_HP = 1; // durability / m_nHitPoint (Mover.h:63)
export const UI_RN = 2; // repair count / m_nRepairNumber (Mover.h:64)
export const UI_AO = 3; // refine level (m_nAbilityOption, Mover.h:65)
export const UI_RAO = 4; // element level (m_nResistAbilityOption, Mover.h:66)
export const UI_IR = 5; // element type (m_bItemResist, Mover.h:67)
export const UI_COOLTIME = 8; // count + start cooldown sweep (Mover.h:68)

/**
 * Build an UPDATE_ITEM snapshot setting item `nId`'s count to `count`.
 * `objid` is the player's, `nId` the stable item objid (C++ `nId` field).
 */
export function buildUpdateItemCount(objid: number, nId: number, count: number): Buffer {
  return buildUpdateItem(objid, nId, UI_NUM, count);
}

/**
 * Build an UPDATE_ITEM snapshot for a durability change -- `OnRepairItem`
 * tail (`DPSrvr.cpp:4994`): `UpdateItem(itemObjId, UI_HP, dwEndurance)`. Sets
 * `m_nHitPoint` to the item's max (full repair). `objid` is the player's,
 * `nId` the stable CItemElem objid.
 */
export function buildUpdateItemDurability(objid: number, nId: number, durability: number): Buffer {
  return buildUpdateItem(objid, nId, UI_HP, durability);
}

/**
 * Build an UPDATE_ITEM snapshot for a refine-level change
 * (`UpdateItem(..., UI_AO, nAbilityOption)` -- `ItemUpgrade.cpp:1118`). The
 * enchant path sends one of these on a successful refine.
 */
export function buildUpdateItemRefine(objid: number, nId: number, refine: number): Buffer {
  return buildUpdateItem(objid, nId, UI_AO, refine);
}

/**
 * Build an UPDATE_ITEM snapshot for an element-type change
 * (`UpdateItem(..., UI_IR, eItemType)` -- `ItemUpgrade.cpp:1286`). Paired with
 * a `buildUpdateItemElementLevel` on element success (two snapshots).
 */
export function buildUpdateItemElement(objid: number, nId: number, element: number): Buffer {
  return buildUpdateItem(objid, nId, UI_IR, element);
}

/**
 * Build an UPDATE_ITEM snapshot for an element-level change
 * (`UpdateItem(..., UI_RAO, m_nResistAbilityOption)` -- `ItemUpgrade.cpp:1287`).
 */
export function buildUpdateItemElementLevel(objid: number, nId: number, level: number): Buffer {
  return buildUpdateItem(objid, nId, UI_RAO, level);
}

/**
 * Build an UPDATE_ITEM snapshot that also signals a cooldown on `nId`
 * (`UpdateItem(..., UI_COOLTIME, newCount)` -- `MoverSkill.cpp:1720`). The
 * client re-derives the sweep duration from the item's own `dwSkillReady`
 * (`DPClient.cpp:3154`); `dwTime` is unused for cooldown, stays 0.
 */
export function buildUpdateItemCooltime(objid: number, nId: number, count: number): Buffer {
  return buildUpdateItem(objid, nId, UI_COOLTIME, count);
}

function buildUpdateItem(objid: number, nId: number, cParam: number, count: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);                          // cb
  w.writeDword(objid);                     // GetId()
  w.writeWord(SNAPSHOTTYPE.UPDATE_ITEM);   // 0x0018
  w.writeByte(0);                          // cType = inventory slot
  w.writeByte(nId & 0xff);                 // nId
  w.writeByte(cParam);                     // UI_NUM / UI_COOLTIME
  w.writeDword(count);                     // dwValue
  w.writeDword(0);                         // dwTime (v19)
  return w.build();
}
