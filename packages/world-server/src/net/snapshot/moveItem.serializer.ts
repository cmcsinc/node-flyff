/**
 * MOVEITEM S->C snapshot -- bag slot-swap confirm. `CUser::AddMoveItem`
 * (`WORLDSERVER/User.cpp:741`):
 *
 *   `[objid][SNAPSHOTTYPE_MOVEITEM=0x0004][BYTE nItemType][BYTE nSrcIndex][BYTE nDestIndex]`
 *
 * The client's drag handler (`WndItemCtrl::OnDropIcon`, `_Interface/WndItemCtrl.cpp:1225`)
 * sends `SendMoveItem` but does NOT swap locally -- `CDPClient::OnMoveItem`
 * (`DPClient.cpp:2141`) performs `m_Inventory.Swap(nSrcIndex, nDestIndex)` only
 * on receipt of this echo. The server also gates the swap (`DPSrvr.cpp:792`:
 * rejects src==dst / out-of-bounds / unusable items) and only echoes on success,
 * so the echo is the authoritative move signal -- omitting it leaves the item
 * pinned client-side. nItemType is always 0 for an inventory swap.
 *
 * @module net/snapshot/moveItem
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID } from './constants.js';

/** Confirm a main-bag swap of `nSrc`<->`nDst` (nItemType is always 0). */
export function buildMoveItem(objid: number, nSrc: number, nDst: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE.MOVEITEM);
  w.writeByte(0);            // nItemType -- unused, always 0
  w.writeByte(nSrc & 0xff);
  w.writeByte(nDst & 0xff);
  return w.build();
}
