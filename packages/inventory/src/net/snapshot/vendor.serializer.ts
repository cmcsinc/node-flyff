/**
 * S->C private-shop (vending) snapshots (`_Network/MsgHdr.h:906-907,966-971`).
 * Each builder is a verbatim port of the matching `CUser::Add*PVendor*` /
 * `CUserMng::Add*PVendor*` in `WORLDSERVER/User.cpp`.
 *
 * Recipient rules (differ per packet, easy to get wrong):
 *  - PVENDOR_OPEN (0x0042): vicinity broadcast when a shop opens -- carries the
 *    title String so peers update the seller's overhead sign.
 *  - PVENDOR_CLOSE (0x0043): the trailing BYTE discriminates `1` (vendor closed
 *    own shop, vicinity broadcast, peers clear the title) from `0` (a buyer
 *    closed their view of someone else's shop, single-target, title kept).
 *  - REGISTER_PVENDOR_ITEM (0x0044): SELF only -- the vendor's own listing ack.
 *  - PVENDOR_ITEM (0x0045): the querying BUYER only -- the full shop window.
 *  - PVENDOR_ITEM_NUM (0x0046): the vendor themselves + anyone currently
 *    browsing them, post-buy remainder + buyer name.
 *  - UNREGISTER_PVENDOR_ITEM (0x0047): SELF only.
 *
 * @module net/snapshot/vendor.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, writeCItemElemBody } from '@flyff/world-core';
import type { InventorySlot } from '@flyff/entities';

/**
 * The bag-elem view of a vendor listing, as serialized to a browsing buyer. The
 * `InventorySlot` is the live bag elem (so its flags/refine/element ride along),
 * `iIndex` is the listing slot, `nExtra` the quantity being sold, `nCost` the
 * per-unit price.
 */
export interface VendorItemView {
  readonly iIndex: number;
  readonly objId: number;
  readonly slot: InventorySlot;
  readonly nExtra: number;
  readonly nCost: number;
}

/** Open a SNAPSHOT frame with one block: `[SNAPSHOT][NULL_ID][cb=1][objid][sub]`. */
function open(objid: number, subtype: number): PacketWriter {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(subtype);
  return w;
}

/**
 * `CUserMng::AddPVendorOpen` (`User.cpp:5379`) -- vicinity broadcast on shop
 * open: `[objidVendor][0x0042][String title]`.
 */
export function buildPVendorOpen(objidVendor: number, title: string): Buffer {
  const w = open(objidVendor, SNAPSHOTTYPE.PVENDOR_OPEN);
  w.writeString(title);
  return w.build();
}

/**
 * `CUserMng::AddPVendorClose` / `CUser::AddPVendorClose` (`User.cpp:5391` /
 * `:893`). `clearTitle=true` -> vicinity, vendor closed own shop (byte 1, peers
 * clear the seller's title). `clearTitle=false` -> single buyer who closed their
 * view (byte 0, title kept).
 */
export function buildPVendorClose(objid: number, clearTitle: boolean): Buffer {
  const w = open(objid, SNAPSHOTTYPE.PVENDOR_CLOSE);
  w.writeByte(clearTitle ? 1 : 0);
  return w.build();
}

/**
 * `CUser::AddRegisterPVendorItem` (`User.cpp:884`) -- self-only listing ack:
 * `[objidSelf][0x0044][BYTE iIndex][BYTE nType][BYTE nId][short nNum][int nCost]`.
 * `nType` is always 0 (server-discarded on register, echoed as 0).
 */
export function buildRegisterPVendorItem(
  objidSelf: number, iIndex: number, nType: number, nId: number,
  nNum: number, nCost: number,
): Buffer {
  const w = open(objidSelf, SNAPSHOTTYPE.REGISTER_PVENDOR_ITEM);
  w.writeByte(iIndex);
  w.writeByte(nType);
  w.writeByte(nId);
  w.writeWord(nNum);
  w.writeDword(nCost);
  return w.build();
}

/**
 * `CUser::AddPVendorItem` (`User.cpp:902`) -- the full shop-window push to a
 * querying buyer: `[objidVendor][0x0045][BYTE count][per slot: iIndex:BYTE,
 * CItemElem blob, nExtra:short, nCost:int][BYTE bState]`. `bState` is the
 * chatting-room open flag; we hardcode 1 (TS has no chatting room).
 */
export function buildPVendorItem(
  objidVendor: number, items: readonly VendorItemView[], bState = 1,
): Buffer {
  const w = open(objidVendor, SNAPSHOTTYPE.PVENDOR_ITEM);
  w.writeByte(items.length);
  for (const it of items) {
    w.writeByte(it.iIndex);
    writeCItemElemBody(w, it.objId, it.slot);
    w.writeWord(it.nExtra);
    w.writeDword(it.nCost);
  }
  w.writeByte(bState ? 1 : 0);
  return w.build();
}

/**
 * `CUserMng::AddPVendorItemNum` (`User.cpp:5403`) -- post-buy remainder to the
 * vendor + anyone browsing them: `[objidVendor][0x0046][BYTE nItem][short nVend]
 * [String sBuyer]`. `nVend` is the NEW remaining count (not the delta).
 */
export function buildPVendorItemNum(
  objidVendor: number, nItem: number, nVend: number, sBuyer: string,
): Buffer {
  const w = open(objidVendor, SNAPSHOTTYPE.PVENDOR_ITEM_NUM);
  w.writeByte(nItem);
  w.writeWord(nVend);
  w.writeString(sBuyer);
  return w.build();
}

/**
 * `CUser::AddUnregisterPVendorItem` (`User.cpp:875`) -- self-only unlisting ack:
 * `[objidSelf][0x0047][BYTE iIndex]`.
 */
export function buildUnregisterPVendorItem(objidSelf: number, iIndex: number): Buffer {
  const w = open(objidSelf, SNAPSHOTTYPE.UNREGISTER_PVENDOR_ITEM);
  w.writeByte(iIndex);
  return w.build();
}
