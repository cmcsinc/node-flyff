/**
 * CREATEITEM serializer byte-layout test.
 *
 * Pins the exact wire width + field offsets against the C++ source
 * (`CUser::AddCreateItem`, User.cpp:727). A one-slot add is:
 *   SNAPSHOT hdr (10) + sub-snapshot:
 *     objid(4) + 0x0003(2) + BYTE0(1) + CItemBase(16) + CItemElem(62)
 *     + nCount(1) + slot(1) + count(2)  = 89
 *   -> 99 B total.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CreateItemSnapshotSerializer } from '../../../src/net/snapshot/createItem.serializer';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_CREATEITEM } from '@flyff/world-core';

describe('CreateItemSnapshotSerializer', () => {
  const serializer = new CreateItemSnapshotSerializer();

  it('buildOne produces a 99 B frame with the C++ AddCreateItem layout', () => {
    const buf = serializer.buildOne(0x00001234, 2950, 3, 5);

    assert.equal(buf.length, 99, 'one-slot CREATEITEM = 99 bytes');

    // SNAPSHOT header
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1, 'cb = 1 sub-snapshot');

    // Sub-snapshot prefix
    assert.equal(buf.readUInt32LE(10), 0x00001234, 'player objid');
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE_CREATEITEM, 'subtype 0x0003');
    assert.equal(buf[16], 0x00, 'literal BYTE 0');

    // CItemBase (16B): objId + itemId + serial(DWORD) + text-len. m_dwObjId is
    // the destination slot index (matches JOIN's container) -- the client
    // CWndInventory will not render an elem whose m_dwObjId is 0.
    assert.equal(buf.readUInt32LE(17), 5, 'm_dwObjId = slot index');
    assert.equal(buf.readUInt32LE(21), 2950, 'm_dwItemId');
    assert.equal(buf.readUInt32LE(25), 0, 'm_liSerialNumber (DWORD)');
    assert.equal(buf.readUInt32LE(29), 0, 'm_szItemText empty string length');

    // CItemElem (62B) -- first field is m_nItemNum (the count)
    assert.equal(buf.readInt16LE(33), 3, 'm_nItemNum = count');

    // Trailer (last 4 bytes): nCount(1) + slot(1) + count(2)
    assert.equal(buf[95], 1, 'nCount = 1');
    assert.equal(buf[96], 5, 'slot id');
    assert.equal(buf.readInt16LE(97), 3, 'per-slot count');
  });

  it('rejects an empty entry list', () => {
    assert.throws(
      () => serializer.build(1, []),
      /at least one entry/,
    );
  });
});
