/**
 * CREATEITEM S->C snapshot -- notify one or more new inventory slots.
 *
 * `CUser::AddCreateItem` (`WORLDSERVER/User.cpp:727`):
 * ```
 * m_Snapshot.cb++;
 * ar << GetId();                    // player objid
 * ar << SNAPSHOTTYPE_CREATEITEM;    // WORD 0x0003
 * ar << (BYTE)0;
 * pItemBase->Serialize( ar );       // CItemElem body (= CItemBase + CItemElem)
 * ar << nCount;                     // BYTE
 * ar.Write( pnId,  sizeof(BYTE)  * nCount );  // slot ids
 * ar.Write( pnNum, sizeof(short) * nCount );  // per-slot counts
 * ```
 *
 * `pItemBase->Serialize` is virtual -> `CItemElem::Serialize` (ObjSerialize.cpp
 * :48) which calls `CItemBase::Serialize` (:31) first. So the body is the SAME
 * 75 B the OT_ITEM ground item writes (CItemBase 20 + CItemElem 55), without
 * the CObj/CCtrl object frame. Per-call a single pItemBase is serialized, then
 * `nCount` (slot, count) pairs fan it into N slots -- used when a drop stacks
 * across several slots. For a single pickup nCount=1.
 *
 * @module net/snapshot/createItem
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_CREATEITEM } from '@flyff/world-core';
import { writeCItemElemBody } from '@flyff/world-core';

/** One slot this snapshot announces. */
export interface CreateItemEntry {
  itemId: number;
  count: number;
  /**
   * The item's client `m_dwObjId` -- what the client's `m_apIndex[slot]` points
   * at, NOT the raw slot index. The client does `SetAtId(objid)` (writes
   * `m_apItem[objid]`) then the grid renders `m_apItem[m_apIndex[slot]]`; the two
   * agree only when this equals `m_apIndex[slot]`. For a never-moved slot that
   * is the slot index (identity); after an unequip->sell drift it is the stale
   * equip objid. Callers pass `player.clientObjId(slot)` (== the placed slot's
   * `objid`). Mirrors vanilla `AddCreateItem(pnId)` where `pnId = m_apIndex[i]`.
   */
  objid: number;
}

export class CreateItemSnapshotSerializer {
  /**
   * Build a CREATEITEM snapshot for one item at client-objid `objid`. The common
   * case (single pickup into one slot) -- wraps a single sub-snapshot.
   */
  buildOne(playerObjid: number, itemId: number, count: number, objid: number): Buffer {
    return this.build(playerObjid, [{ itemId, count, objid }]);
  }

  /**
   * Build a CREATEITEM snapshot. All entries share one pItemBase body only when
   * they describe the same itemId fanned across slots; callers picking up a
   * single stack should pass one entry. Distinct itemIds in one call is not a
   * real C++ path -- emit one snapshot per distinct item.
   */
  build(playerObjid: number, entries: readonly CreateItemEntry[]): Buffer {
    if (entries.length === 0) throw new Error('CREATEITEM requires at least one entry');
    const first = entries[0];
    if (!first) throw new Error('CREATEITEM requires at least one entry');

    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);   // dwHdr
    w.writeDword(NULL_ID);               // objidPlayer -- unused
    w.writeWord(entries.length);         // cb (one sub-snapshot per entry)

    for (const e of entries) this.writeOne(w, playerObjid, first.itemId, e);
    return w.build();
  }

  /** One AddCreateItem sub-snapshot: body uses the shared itemId, trailer per slot. */
  private writeOne(w: PacketWriter, playerObjid: number, bodyItemId: number, e: CreateItemEntry): void {
    w.writeDword(playerObjid);             // GetId()
    w.writeWord(SNAPSHOTTYPE_CREATEITEM);  // 0x0003
    w.writeByte(0);                        // the literal (BYTE)0

    // Shared CItemBase + CItemElem body (72 B). m_dwObjId MUST be the item's
    // client objid (m_apIndex[slot]), NOT the raw slot: the client's
    // CWndInventory renders elems by m_apItem[m_apIndex[slot]], so a slot that
    // drifted (unequip->sell) needs the stale objid or the item is invisible
    // until relog. For never-moved slots objid == slot (identity), so this is
    // backward-compatible with pickups into fresh slots.
    writeCItemElemBody(w, e.objid, { itemId: bodyItemId, count: e.count });

    // Trailer -- per-objid fan-out. pnId is the client m_apIndex value (SetAtId
    // target), matching vanilla AddCreateItem where pnId = m_apIndex[i].
    w.writeByte(1);                       // nCount = 1 (this sub-snapshot covers one slot)
    w.writeByte(e.objid & 0xff);          // pnId[0] -- client objid (m_apIndex[slot])
    w.writeWord(e.count & 0xffff);        // pnNum[0] -- count
  }
}
