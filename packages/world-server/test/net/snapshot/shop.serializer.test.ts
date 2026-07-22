/**
 * OPENSHOPWND serializer byte-layout test.
 *
 * Pins `CUser::AddOpenShopWnd` (User.cpp:865): SNAPSHOT hdr (16 B) + vendor
 * objid + OPENSHOPWND + 4 vendor tabs. Each tab is `writeItemContainer(100,
 * contents)` -- `m_apIndex` (100 DWORD), `chSize` BYTE, occupied slot bodies
 * (CItemElem 78 B each), `adwObjIndex` (100 DWORD). Empty tab = 801 B; one
 * slot occupied = 801 + 78 = 879 B.
 *
 * One item in tab 0 + empty tabs 1-3 => 16 + 879 + 801*3 = 3298 B.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildOpenShopWnd } from '../../../src/net/snapshot/shop.serializer.js';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID, MAX_VENDOR_INVENTORY } from '../../../src/net/snapshot/constants.js';
import type { VendorStock } from '../../../src/entities/mover.js';

/** Tab 0 carries one item (id 81) at slot 0; tabs 1-3 empty. */
const STOCK: VendorStock = Object.freeze([
  Object.freeze([({ itemId: 81, count: 1 } as never), ...Array.from({ length: MAX_VENDOR_INVENTORY - 1 }, () => null)]),
  Object.freeze(Array.from({ length: MAX_VENDOR_INVENTORY }, () => null)),
  Object.freeze(Array.from({ length: MAX_VENDOR_INVENTORY }, () => null)),
  Object.freeze(Array.from({ length: MAX_VENDOR_INVENTORY }, () => null)),
]) as VendorStock;

describe('buildOpenShopWnd', () => {
  const VENDOR = 0x40000001;
  const buf = buildOpenShopWnd(VENDOR, STOCK);

  it('produces the AddOpenShopWnd layout: 16 B hdr + 4 tabs', () => {
    // 16 (snapshot hdr + objid + subtype) + 880 (tab0: 1 item @78B + slot byte) + 801*3
    assert.equal(buf.length, 16 + 880 + 801 * 3, 'one-stock + three-empty = 3299 bytes');

    // SNAPSHOT header
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1, 'cb = 1 sub-snapshot');
    assert.equal(buf.readUInt32LE(10), VENDOR, 'vendor objid');
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.OPENSHOPWND, 'subtype OPENSHOPWND');
  });

  it('serializes the populated tab 0 container', () => {
    const tab0 = 16;
    // m_apIndex: slot 0 occupied (index 0), rest NULL_ID
    assert.equal(buf.readUInt32LE(tab0 + 0), 0, 'm_apIndex[0] = slot 0');
    assert.equal(buf.readUInt32LE(tab0 + 4), NULL_ID, 'm_apIndex[1] = NULL_ID');

    const mApEnd = tab0 + 4 * MAX_VENDOR_INVENTORY; // after 100 DWORDs
    assert.equal(buf[mApEnd], 1, 'chSize = 1 occupied slot');
    assert.equal(buf[mApEnd + 1], 0, 'occupied slot index = 0');

    // CItemElem body (72 B) starts right after chSize + slot byte.
    const body = mApEnd + 2;
    assert.equal(buf.readUInt32LE(body + 0), 0, 'm_dwObjId = slot index');
    assert.equal(buf.readUInt32LE(body + 4), 81, 'm_dwItemId = 81');
    assert.equal(buf.readUInt32LE(body + 8), 0, 'm_liSerialNumber (DWORD)');
    assert.equal(buf.readInt16LE(body + 16), 1, 'm_nItemNum = count 1');
    // 78 B body -> adwObjIndex follows at body + 78
    assert.equal(buf.readUInt32LE(body + 78 + 0), 0, 'adwObjIndex[0] = slot 0');
    assert.equal(buf.readUInt32LE(body + 78 + 4), NULL_ID, 'adwObjIndex[1] = NULL_ID');
  });

  it('serializes an empty tab identically to the empty container', () => {
    // Tab 1 starts after tab 0 (880 B): 16 + 880 = 896.
    const tab1 = 16 + 880;
    for (let i = 0; i < MAX_VENDOR_INVENTORY; i++) {
      assert.equal(buf.readUInt32LE(tab1 + i * 4), NULL_ID, `tab1 m_apIndex[${i}] = NULL_ID`);
    }
    assert.equal(buf[tab1 + 4 * MAX_VENDOR_INVENTORY], 0, 'tab1 chSize = 0');
  });

  it('renders an all-empty vendor (no stock) as 4 empty tabs', () => {
    const empty = buildOpenShopWnd(VENDOR, Object.freeze(
      Array.from({ length: 4 }, () => Object.freeze(Array.from({ length: MAX_VENDOR_INVENTORY }, () => null))),
    ) as VendorStock);
    // 16 hdr + 4 * 801 empty tabs = 3220 B
    assert.equal(empty.length, 16 + 4 * 801);
    assert.equal(empty[16 + 4 * MAX_VENDOR_INVENTORY], 0, 'tab0 chSize = 0');
  });
});
