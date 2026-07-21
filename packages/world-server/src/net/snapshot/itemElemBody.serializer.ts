/**
 * CItemElem body — the shared 75-byte item serialize chain.
 *
 * `CItemElem::Serialize` (`_Common/ObjSerialize.cpp:48`) calls `CItemBase::
 * Serialize` (:31) first, then the elem block. Single source of truth for the
 * CREATEITEM snapshot, the JOIN inventory/bank containers, and the OT_ITEM
 * ground-item ADD_OBJ — all three write the identical body.
 *
 * Layout (CItemBase 20B + CItemElem 55B = 75B):
 *   CItemBase: DWORD m_dwObjId, DWORD m_dwItemId, LONGLONG m_liSerialNumber,
 *              DWORD-len String m_szItemText (empty here).
 *   CItemElem: short m_nItemNum, short m_nRepairNumber, int m_nHitPoint,
 *              short m_nRepair, BYTE m_byFlag, int m_nAbilityOption,
 *              u_long m_idGuild, BYTE m_bItemResist, int m_nResistAbilityOption,
 *              int m_nResistSMItemId, piercing/ultimate/pet sizes (3×DWORD 0),
 *              BYTE m_bCharged, LONGLONG m_iRandomOptItemId, DWORD m_dwKeepTime,
 *              BYTE bPet, BYTE m_bTranformVisPet.
 *
 * @module net/snapshot/itemElemBody
 */

import type { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import type { InventorySlot } from '../../entities/player.js';

/**
 * Write the CItemBase + CItemElem body for one slot. `objId` is the per-slot
 * inventory elem id (v15 `m_dwObjId`, 0..255 — we use the slot index). A null
 * slot is an error — callers skip empties.
 */
export function writeCItemElemBody(w: PacketWriter, objId: number, slot: InventorySlot): void {
  const refine = slot.refine ?? 0;
  const flags = slot.flags ?? 0;
  const dur = slot.durability ?? -1;

  // CItemBase (20B)
  w.writeDword(objId);                 // m_dwObjId
  w.writeDword(slot.itemId);           // m_dwItemId
  w.writeQword(0);                     // m_liSerialNumber
  w.writeDword(0);                     // m_szItemText length (empty String)

  // CItemElem (55B)
  w.writeWord(slot.count);             // m_nItemNum
  w.writeWord(0);                      // m_nRepairNumber
  w.writeDword(dur < 0 ? 0 : dur);     // m_nHitPoint (-1 indestructible → 0 on wire)
  w.writeWord(0);                      // m_nRepair
  w.writeByte(flags & 0xff);           // m_byFlag
  w.writeDword(refine << 4);           // m_nAbilityOption (refine encoded high nibble)
  w.writeDword(0);                     // m_idGuild
  w.writeByte(0);                      // m_bItemResist
  w.writeDword(0);                     // m_nResistAbilityOption
  w.writeDword(0);                     // m_nResistSMItemId
  w.writeDword(0);                     // piercing size
  w.writeDword(0);                     // ultimate piercing size
  w.writeDword(0);                     // pet vis keep-time size
  w.writeByte(0);                      // m_bCharged
  w.writeQword(0);                     // m_iRandomOptItemId
  w.writeDword(0);                     // m_dwKeepTime
  w.writeByte(0);                      // bPet
  w.writeByte(0);                      // m_bTranformVisPet
}
