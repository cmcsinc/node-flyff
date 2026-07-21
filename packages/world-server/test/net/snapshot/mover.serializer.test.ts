/**
 * writeItemContainer byte-layout test — the Phase 0B JOIN fix.
 *
 * Pins `CItemContainer<CItemElem>::Serialize` (`_Common/Item.h:892`, storing):
 *   [m_apIndex: DWORD×slots][BYTE chSize][per occupied: BYTE slot + 75 B body]
 *   [adwObjIndex: DWORD×slots]
 *
 * This is the core JOIN-population fix: a player rejoining with items now sees
 * their real bag instead of the all-NULL empty container. The empty case must
 * still reproduce the pre-fix bytes (empty container = NULL_ID × slots + 0 +
 * NULL_ID × slots).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { writeItemContainer } from '../../../src/net/snapshot/mover.serializer.js';
import { NULL_ID, emptyItemContainerSize } from '../../../src/net/snapshot/constants.js';

describe('writeItemContainer', () => {
  it('empty container = NULL_ID×slots + chSize 0 + NULL_ID×slots', () => {
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, null, null]);
    const buf = w.build();
    assert.equal(buf.length, emptyItemContainerSize(3), '3 slots empty = 25 bytes');
    // m_apIndex all NULL_ID
    assert.equal(buf.readUInt32LE(0), NULL_ID);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt32LE(8), NULL_ID);
    assert.equal(buf[12], 0, 'chSize = 0 occupied');
    // adwObjIndex all NULL_ID
    assert.equal(buf.readUInt32LE(13), NULL_ID);
    assert.equal(buf.readUInt32LE(17), NULL_ID);
    assert.equal(buf.readUInt32LE(21), NULL_ID);
  });

  it('populated: m_apIndex holds the slot index for occupied slots', () => {
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, { itemId: 2950, count: 2 }, null]);
    const buf = w.build();
    assert.equal(buf.readUInt32LE(0), NULL_ID, 'slot 0 empty');
    assert.equal(buf.readUInt32LE(4), 1, 'slot 1 occupied → index = 1');
    assert.equal(buf.readUInt32LE(8), NULL_ID, 'slot 2 empty');
    assert.equal(buf[12], 1, 'chSize = 1 occupied');
  });

  it('populated: occupied body = BYTE slot + 75 B CItemElem, then trailing adwObjIndex', () => {
    const w = new PacketWriter();
    writeItemContainer(w, 3, [null, { itemId: 2950, count: 2 }, null]);
    const buf = w.build();

    // [m_apIndex 12][chSize 1] = 13. Then occupied record: BYTE slot + 75 B body = 76.
    assert.equal(buf[13], 1, 'occupied record slot byte = 1');
    // Body begins at offset 14: m_dwObjId(=slot) then m_dwItemId.
    assert.equal(buf.readUInt32LE(14), 1, 'body m_dwObjId = slot index');
    assert.equal(buf.readUInt32LE(18), 2950, 'body m_dwItemId');
    assert.equal(buf.readInt16LE(34), 2, 'body m_nItemNum = count');

    // adwObjIndex trails immediately after the body: offset 13 + 1 + 75 = 89.
    assert.equal(buf.readUInt32LE(89), NULL_ID, 'adwObjIndex[0] empty');
    assert.equal(buf.readUInt32LE(93), 1, 'adwObjIndex[1] = slot index');
    assert.equal(buf.readUInt32LE(97), NULL_ID, 'adwObjIndex[2] empty');
    assert.equal(buf.length, 101, '3 slots / 1 occupied = 101 bytes');
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
    // First occupied record at offset 21: slot byte 0 + 75 B body (body@22).
    assert.equal(buf[21], 0, 'first record slot = 0');
    assert.equal(buf.readUInt32LE(22), 0, 'first body m_dwObjId = slot 0');
    assert.equal(buf.readUInt32LE(26), 100, 'first body itemId');
    // Second occupied record at 21 + 1 + 75 = 97: slot byte + body (body@98).
    assert.equal(buf[97], 2, 'second record slot = 2');
    assert.equal(buf.readUInt32LE(98), 2, 'second body m_dwObjId = slot 2');
    assert.equal(buf.readUInt32LE(102), 300, 'second body itemId');
    assert.equal(buf.readInt16LE(118), 4, 'second body count');
  });
});
