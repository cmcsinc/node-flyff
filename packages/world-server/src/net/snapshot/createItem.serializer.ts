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

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID, SNAPSHOTTYPE_CREATEITEM } from './constants.js';
import { writeCItemElemBody } from './itemElemBody.serializer.js';

/** One slot this snapshot announces. */
export interface CreateItemEntry {
  itemId: number;
  count: number;
  /** Inventory slot index (0..MAX_INVENTORY-1 main bag). */
  slot: number;
}

export class CreateItemSnapshotSerializer {
  /**
   * Build a CREATEITEM snapshot for one item landing in `slot`. The common
   * case (single pickup into one slot) -- wraps a single sub-snapshot.
   */
  buildOne(playerObjid: number, itemId: number, count: number, slot: number): Buffer {
    return this.build(playerObjid, [{ itemId, count, slot }]);
  }

  /**
   * Build a CREATEITEM snapshot. All entries share one pItemBase body only when
   * they describe the same itemId fanned across slots; callers picking up a
   * single stack should pass one entry. Distinct itemIds in one call is not a
   * real C++ path -- emit one snapshot per distinct item.
   */
  build(playerObjid: number, entries: readonly CreateItemEntry[]): Buffer {
    if (entries.length === 0) throw new Error('CREATEITEM requires at least one entry');
    const first = entries[0]!;

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

    // Shared CItemBase + CItemElem body (72 B) -- m_dwObjId=0 for a fresh
    // inventory item. Single source of truth with the JOIN inventory/bank
    // containers + OT_ITEM ground item (itemElemBody.serializer.ts).
    writeCItemElemBody(w, 0, { itemId: bodyItemId, count: e.count });

    // Trailer -- per-slot fan-out.
    w.writeByte(1);                       // nCount = 1 (this sub-snapshot covers one slot)
    w.writeByte(e.slot & 0xff);           // pnId[0] -- slot id
    w.writeWord(e.count & 0xffff);        // pnNum[0] -- count
  }
}
