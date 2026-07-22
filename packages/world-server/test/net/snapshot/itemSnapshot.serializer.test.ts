/**
 * ItemSnapshotSerializer -- exact byte-width assertion for the OT_ITEM ADD_OBJ
 * frame. The empty-drop layout is fully determined by the C++ serialize chain;
 * pin the total so a future field drift is caught immediately.
 *
 * Width breakdown (per entry, after the 10B SNAPSHOT header):
 *   ADD_OBJ prefix:  4+2+1+4          = 11
 *   CObj:            1+4+2+12+2       = 21
 *   CCtrl:           4                =  4
 *   CItemBase:       4+4+4+4          = 16  (serial DWORD + empty String DWORD)
 *   CItemElem:       2+1+4+4+1+4+4+1+4+4+12+4+8+4+1+4 = 62  (m_bCharged/m_bTranformVisPet are BOOL -> 4B)
 *   per-entry total: 11+21+4+16+62    = 114
 *   1-entry packet:  10 (header) + 114 = 124
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ItemSnapshotSerializer } from '../../../src/net/snapshot/itemSnapshot.serializer.js';
import { GroundItem } from '../../../src/entities/item.js';

const HEADER = 10; // SNAPSHOT DWORD + NULL_ID DWORD + count WORD
const PER_ENTRY = 114;

describe('ItemSnapshotSerializer', () => {
  it('emits the exact pinned empty-drop byte width for one item', () => {
    const ser = new ItemSnapshotSerializer();
    const item = GroundItem.spawn(0x80000000, { itemId: 2950, count: 1, ownerId: 1, pos: { x: 0, y: 0, z: 0 }, zoneId: 1 }, 0);
    const buf = ser.build([item]);
    assert.equal(buf.length, HEADER + PER_ENTRY);

    // Header sanity.
    assert.equal(buf.readUInt32LE(0), 0xffffff00); // PACKETTYPE.SNAPSHOT
    assert.equal(buf.readUInt32LE(4), 0xffffffff); // NULL_ID
    assert.equal(buf.readUInt16LE(8), 1);          // count
    // First entry: objid + ADD_OBJ + OT_ITEM + dwObjIndex.
    assert.equal(buf.readUInt32LE(10), 0x80000000);
    assert.equal(buf.readUInt16LE(14), 0x00f0);    // ADD_OBJ
    assert.equal(buf.readUInt8(16), 4);            // OT_ITEM
    // dwObjIndex MUST carry the propItem id -- CItem::GetProp() reads GetIndex()
    // (Item.h:985), not CItemBase.m_dwItemId. 0 here = GetItemProp(0) = null ->
    // crash at OnAddObj:1264 (pItemProp nullptr on pickup/spawn-ding).
    assert.equal(buf.readUInt32LE(17), 2950, 'dwObjIndex = item id');
    // ...and the duplicate m_dwIndex in CObj::Serialize (offset +21B from prefix).
    assert.equal(buf.readUInt32LE(22), 2950, 'm_dwIndex = item id');
  });

  it('DEL_OBJ payload is the bodyless 16-byte form', () => {
    const ser = new ItemSnapshotSerializer();
    const buf = ser.buildRemove(0x80000005);
    assert.equal(buf.length, HEADER + 4 + 2);      // objid + subtype only
    assert.equal(buf.readUInt16LE(8), 1);          // count
    assert.equal(buf.readUInt32LE(10), 0x80000005);
    assert.equal(buf.readUInt16LE(14), 0x00f1);    // DEL_OBJ
  });

  it('scales linearly: N entries = HEADER + N*PER_ENTRY', () => {
    const ser = new ItemSnapshotSerializer();
    const items = [1, 2, 3].map((id) =>
      GroundItem.spawn(0x80000000 + id, { itemId: id, count: 1, ownerId: 1, pos: { x: 0, y: 0, z: 0 }, zoneId: 1 }, 0));
    const buf = ser.build(items);
    assert.equal(buf.length, HEADER + 3 * PER_ENTRY);
  });
});
