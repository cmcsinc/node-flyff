/**
 * writeCItemElemBody byte-layout test.
 *
 * Pins the shared 75-byte CItemBase + CItemElem body against
 * `_Common/ObjSerialize.cpp:31/48`. This body is the single source of truth
 * consumed by CREATEITEM, the JOIN inventory/bank containers, and the OT_ITEM
 * ground-item ADD_OBJ — a width regression here desyncs all three.
 *
 * Layout (75B): CItemBase 20 + CItemElem 55. See the source module header for
 * the per-field offset map.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { writeCItemElemBody } from '../../../src/net/snapshot/itemElemBody.serializer.js';
import type { InventorySlot } from '../../../src/entities/player.js';

describe('writeCItemElemBody', () => {
  it('writes exactly 75 bytes for a populated slot', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 5, { itemId: 2950, count: 3 });
    const buf = w.build();
    assert.equal(buf.length, 75);
  });

  it('encodes CItemBase header fields at their canonical offsets', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 7, { itemId: 1234, count: 1 });
    const buf = w.build();
    assert.equal(buf.readUInt32LE(0), 7, 'm_dwObjId = slot objid');
    assert.equal(buf.readUInt32LE(4), 1234, 'm_dwItemId');
    assert.equal(buf.readBigUInt64LE(8), 0n, 'm_liSerialNumber');
    assert.equal(buf.readUInt32LE(16), 0, 'm_szItemText empty');
  });

  it('encodes count, flags, refine<<4, durability into CItemElem fields', () => {
    const slot: InventorySlot = { itemId: 9, count: 42, flags: 0x80, refine: 5, durability: 200 };
    const w = new PacketWriter();
    writeCItemElemBody(w, 0, slot);
    const buf = w.build();
    assert.equal(buf.readInt16LE(20), 42, 'm_nItemNum = count');
    assert.equal(buf.readUInt32LE(24), 200, 'm_nHitPoint = durability');
    assert.equal(buf[30], 0x80, 'm_byFlag = flags');
    assert.equal(buf.readUInt32LE(31), 5 << 4, 'm_nAbilityOption = refine<<4');
  });

  it('writes durability -1 (indestructible) as 0 on the wire', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 0, { itemId: 1, count: 1, durability: -1 });
    const buf = w.build();
    assert.equal(buf.readUInt32LE(24), 0, 'negative durability → 0');
  });

  it('defaults missing optional fields to 0 (plain drop)', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 2, { itemId: 1, count: 1 });
    const buf = w.build();
    assert.equal(buf[30], 0, 'flags default 0');
    assert.equal(buf.readUInt32LE(31), 0, 'refine default 0');
    assert.equal(buf.readUInt32LE(24), 0, 'durability default → 0');
  });
});
