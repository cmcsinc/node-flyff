/**
 * Shop S->C snapshots -- `CUser::AddOpenShopWnd` (`WORLDSERVER/User.cpp:865`):
 *   `[objid][SNAPSHOTTYPE_OPENSHOPWND][CItemContainer x MAX_VENDOR_INVENTORY_TAB]`
 *
 * The client (`Neuz/DPClient.cpp:2784`) drains exactly 4 vendor tabs then opens
 * `CWndShop`. Each tab is a 100-wide `CItemContainer<CItemElem>` serialized via
 * `writeItemContainer`. `stock` is the vendor's resolved 4-tab inventory; an
 * all-null tab serializes as the empty container, so vendors with no declared
 * stock just show nothing.
 *
 * @module net/snapshot/shop
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, MAX_VENDOR_INVENTORY, MAX_VENDOR_INVENTORY_TAB } from './constants';
import { writeItemContainer } from './mover.serializer';
import type { VendorStock } from '@flyff/entities';

/**
 * Acknowledge OPENSHOPWND for vendor `vendorId`. Per `AddOpenShopWnd`
 * (User.cpp:865) the snapshot objid is the *vendor's* id, followed by the 4
 * shop tabs in `stock`.
 */
export function buildOpenShopWnd(vendorId: number, stock: VendorStock): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(vendorId);
  w.writeWord(SNAPSHOTTYPE.OPENSHOPWND);
  for (let i = 0; i < MAX_VENDOR_INVENTORY_TAB; i++) {
    writeItemContainer(w, MAX_VENDOR_INVENTORY, stock[i] ?? new Array(MAX_VENDOR_INVENTORY).fill(null));
  }
  return w.build();
}
