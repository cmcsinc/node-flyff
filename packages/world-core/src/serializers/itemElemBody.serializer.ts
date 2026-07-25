/**
 * CItemElem body -- the shared 72-byte item serialize chain.
 *
 * `CItemElem::Serialize` (`_Common/ObjSerialize.cpp:48`) calls `CItemBase::
 * Serialize` (:31) first, then the elem block. Single source of truth for the
 * CREATEITEM snapshot, the JOIN inventory/bank containers, and the OT_ITEM
 * ground-item ADD_OBJ -- all three write the identical body.
 *
 * Layout (CItemBase 16B + CItemElem 62B = 78B). Field widths are the WIRE
 * widths from `CItemElem::Serialize` / `CItemBase::Serialize` (ObjSerialize.cpp
 * :31/48), NOT the C++ struct layout -- get these wrong and every item past
 * the first desyncs the client's read pointer (cumulative byte drift) until a
 * garbage m_dwItemId null-derefs in `CItemBase::SetTexture` (Item.cpp:92, no
 * early return on the null `GetProp()`). Width sources:
 *   CItemBase: DWORD m_dwObjId, DWORD m_dwItemId, DWORD m_liSerialNumber
 *             (SERIALNUMBER = DWORD, CmnHdr.h:88 -- NOT __int64), DWORD-len
 *             String m_szItemText (empty here).
 *   CItemElem: short m_nItemNum, BYTE m_nRepairNumber, int m_nHitPoint,
 *             int m_nRepair, BYTE m_byFlag, int m_nAbilityOption,
 *             DWORD m_idGuild, BYTE m_bItemResist, int m_nResistAbilityOption,
 *             int m_nResistSMItemId, CPiercing::Serialize (3*DWORD 0),
 *             BOOL m_bCharged, __int64 m_iRandomOptItemId, DWORD m_dwKeepTime,
 *             BYTE bPet, BOOL m_bTranformVisPet.
 *
 * BOOL wire width is 4B, NOT 1B: Win32 `typedef int BOOL` and `CAr` (ar.h:47)
 * has no `operator<<(BOOL)` overload, so `ar << m_bCharged` / `ar <<
 * m_bTranformVisPet` resolve to `operator<<(int)` -> `operator<<((LONG))` =
 * 4 bytes. Writing these as BYTE was the shop-open crash: the body came out
 * 6B short per item, so item #2+ in a populated `CItemContainer<CItemElem>`
 * read a garbage m_dwItemId -> null prop -> SetTexture null-deref. (The v19
 * shop tab was the first populated container ever sent; JOIN spawns the
 * player naked, so the bug was latent until now.) `bPet` stays BYTE -- the
 * C++ stores it as an explicit `(BYTE)0x00` cast (ObjSerialize.cpp:78,83).
 *
 * @module net/snapshot/itemElemBody
 */

import type { PacketWriter } from '@flyff/core/net/PacketWriter';
import type { InventorySlot } from '@flyff/entities';

/**
 * Write the CItemBase + CItemElem body for one slot. `objId` is the per-slot
 * inventory elem id (v19 `m_dwObjId`, 0..255 -- we use the slot index). A null
 * slot is an error -- callers skip empties.
 */
export function writeCItemElemBody(w: PacketWriter, objId: number, slot: InventorySlot): void {
  const refine = slot.refine ?? 0;
  const flags = slot.flags ?? 0;
  const dur = slot.durability ?? -1;
  const element = slot.element ?? 0;
  const elemLevel = slot.element_level ?? 0;

  // CItemBase (16B)
  w.writeDword(objId);                 // m_dwObjId
  w.writeDword(slot.itemId);           // m_dwItemId
  w.writeDword(0);                     // m_liSerialNumber (SERIALNUMBER = DWORD)
  w.writeDword(0);                     // m_szItemText length (empty String)

  // CItemElem (56B)
  w.writeWord(slot.count);             // m_nItemNum
  w.writeByte(0);                      // m_nRepairNumber (BYTE)
  w.writeDword(dur < 0 ? 0 : dur);     // m_nHitPoint (-1 indestructible -> 0 on wire)
  w.writeDword(0);                     // m_nRepair (int)
  w.writeByte(flags & 0xff);           // m_byFlag
  w.writeDword(refine << 4);           // m_nAbilityOption (refine encoded high nibble)
  w.writeDword(0);                     // m_idGuild
  w.writeByte(element & 0xff);         // m_bItemResist (element type)
  w.writeDword(elemLevel);             // m_nResistAbilityOption (element level)
  w.writeDword(0);                     // m_nResistSMItemId
  w.writeDword(0);                     // piercing size (CPiercing::Serialize, empty)
  w.writeDword(0);                     // ultimate piercing size (__VER>=12)
  w.writeDword(0);                     // pet vis keep-time size (__VER>=15)
  w.writeDword(0);                     // m_bCharged (BOOL = int -> 4B; ar.h: no BOOL overload -> operator<<(int)->LONG)
  w.writeQword(0);                     // m_iRandomOptItemId (__int64)
  w.writeDword(0);                     // m_dwKeepTime (0 -> skip conditional time_t)
  w.writeByte(0);                      // bPet (__VER>=9; explicit (BYTE) cast -> 1B; 0 = no pet -> skip CPet body)
  w.writeDword(0);                     // m_bTranformVisPet (BOOL = int -> 4B; __VER>=15)
}

