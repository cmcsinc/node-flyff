/**
 * writeItemContainer byte-layout test -- the Phase 0B JOIN fix.
 *
 * Pins `CItemContainer<CItemElem>::Serialize` (`_Common/Item.h:892`, storing):
 *   [m_apIndex: DWORD*slots][BYTE chSize][per occupied: BYTE slot + 78 B body]
 *   [adwObjIndex: DWORD*slots]
 *
 * `m_apIndex[i] = i` (identity) for the visible bag range `i < indexNum`, per
 * `CItemContainer::Clear()` (Item.h:480). This identity table is what lets the
 * bag grid (`CWndItemCtrl::OnDraw` -> `GetAt(i) = m_apItem[m_apIndex[i]]`,
 * Item.h:818) render a slot that a later CREATEITEM fills via `SetAtId` (which
 * writes m_apItem but never m_apIndex). Empty bag slots MUST be `i`, not
 * NULL_ID, or a bought/picked-up item is invisible until relog.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { writeItemContainer } from '../src/serializers/itemContainer';
import { NULL_ID, emptyItemContainerSize } from '@flyff/world-core';

describe('writeItemContainer', () => {
  it('empty container = identity m_apIndex + chSize 0 + identity adwObjIndex', () => {
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, null, null]);
    const buf = w.build();
    assert.equal(buf.length, emptyItemContainerSize(3), '3 slots empty = 25 bytes');
    // m_apIndex identity (Clear() sets m_apIndex[i] = i for i < m_dwIndexNum)
    assert.equal(buf.readUInt32LE(0), 0, 'm_apIndex[0] = 0 (identity)');
    assert.equal(buf.readUInt32LE(4), 1, 'm_apIndex[1] = 1 (identity)');
    assert.equal(buf.readUInt32LE(8), 2, 'm_apIndex[2] = 2 (identity)');
    assert.equal(buf[12], 0, 'chSize = 0 occupied');
    // adwObjIndex identity
    assert.equal(buf.readUInt32LE(13), 0);
    assert.equal(buf.readUInt32LE(17), 1);
    assert.equal(buf.readUInt32LE(21), 2);
  });

  it('populated: m_apIndex is identity for every bag slot (occupied or not)', () => {
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, { itemId: 2950, count: 2 }, null]);
    const buf = w.build();
    assert.equal(buf.readUInt32LE(0), 0, 'slot 0 empty -> still identity 0');
    assert.equal(buf.readUInt32LE(4), 1, 'slot 1 occupied -> identity 1');
    assert.equal(buf.readUInt32LE(8), 2, 'slot 2 empty -> still identity 2');
    assert.equal(buf[12], 1, 'chSize = 1 occupied');
  });

  it('populated: occupied body = BYTE slot + 78 B CItemElem, then trailing adwObjIndex', () => {
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, { itemId: 2950, count: 2 }, null]);
    const buf = w.build();

    // [m_apIndex 12][chSize 1] = 13. Then occupied record: BYTE slot + 78 B body = 79.
    assert.equal(buf[13], 1, 'occupied record slot byte = 1');
    // Body begins at offset 14: m_dwObjId(=slot) then m_dwItemId.
    assert.equal(buf.readUInt32LE(14), 1, 'body m_dwObjId = slot index');
    assert.equal(buf.readUInt32LE(18), 2950, 'body m_dwItemId');
    assert.equal(buf.readInt16LE(30), 2, 'body m_nItemNum = count');

    // adwObjIndex trails immediately after the body: offset 13 + 1 + 78 = 92.
    assert.equal(buf.readUInt32LE(92), 0, 'adwObjIndex[0] = identity 0');
    assert.equal(buf.readUInt32LE(96), 1, 'adwObjIndex[1] = identity 1');
    assert.equal(buf.readUInt32LE(100), 2, 'adwObjIndex[2] = identity 2');
    assert.equal(buf.length, 104, '3 slots / 1 occupied = 104 bytes');
  });

  it('multiple occupied slots: chSize counts occupied, bodies follow in order', () => {
    const w = new PacketWriter();
    const contents = [
      { itemId: 100, count: 1 }, null, { itemId: 300, count: 4 }, null, null,
    ] as const;
    writeItemContainer(w, 5, contents);
    const buf = w.build();
    // m_apIndex = 5 DWORDs = 20 bytes; chSize at offset 20.
    assert.equal(buf[20], 2, 'chSize = 2 occupied');
    // First occupied record at offset 21: slot byte 0 + 78 B body (body@22).
    assert.equal(buf[21], 0, 'first record slot = 0');
    assert.equal(buf.readUInt32LE(22), 0, 'first body m_dwObjId = slot 0');
    assert.equal(buf.readUInt32LE(26), 100, 'first body itemId');
    // Second occupied record at 21 + 1 + 78 = 100: slot byte + body (body@101).
    assert.equal(buf[100], 2, 'second record slot = 2');
    assert.equal(buf.readUInt32LE(101), 2, 'second body m_dwObjId = slot 2');
    assert.equal(buf.readUInt32LE(105), 300, 'second body itemId');
    assert.equal(buf.readInt16LE(117), 4, 'second body count');
  });

  it('indexNum < slots: equip-extension empty slots stay NULL_ID (matches Clear)', () => {
    // Inventory shape: indexNum=2 bag slots + 1 equip-part slot (3 total).
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, null, null], 2);
    const buf = w.build();
    assert.equal(buf.readUInt32LE(0), 0, 'bag slot 0 identity');
    assert.equal(buf.readUInt32LE(4), 1, 'bag slot 1 identity');
    assert.equal(buf.readUInt32LE(8), NULL_ID, 'equip slot 2 empty -> NULL_ID');
    assert.equal(buf.readUInt32LE(13), 0, 'adwObjIndex[0] identity');
    assert.equal(buf.readUInt32LE(17), 1, 'adwObjIndex[1] identity');
    assert.equal(buf.readUInt32LE(21), NULL_ID, 'adwObjIndex[2] equip -> NULL_ID');
  });
});
