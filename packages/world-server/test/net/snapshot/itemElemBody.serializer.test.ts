/**
 * writeCItemElemBody byte-layout test.
 *
 * Pins the shared 78-byte CItemBase + CItemElem body against
 * `_Common/ObjSerialize.cpp:31/48`. This body is the single source of truth
 * consumed by CREATEITEM, the JOIN inventory/bank containers, and the OT_ITEM
 * ground-item ADD_OBJ -- a width regression here desyncs all three and crashes
 * Neuz in `CItemBase::SetTexture` (null GetProp on a garbage m_dwItemId).
 *
 * Layout (78B): CItemBase 16 + CItemElem 62. The two BOOL fields (m_bCharged,
 * m_bTranformVisPet) serialize as 4B (`BOOL`=`int`, no CAr BOOL overload) -- a
 * prior 72B variant wrote them BYTE and crashed the v15 shop window. See the
 * source module header for the per-field offset map.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { writeCItemElemBody } from '../../../src/net/snapshot/itemElemBody.serializer';
import type { InventorySlot } from '@flyff/entities';

describe('writeCItemElemBody', () => {
  it('writes exactly 78 bytes for a populated slot', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 5, { itemId: 2950, count: 3 });
    const buf = w.build();
    assert.equal(buf.length, 78);
  });

  it('serializes BOOL fields m_bCharged / m_bTranformVisPet as 4B each', () => {
    // Regression guard for the shop-open SetTexture crash: both BOOL fields
    // must land as DWORD (4B), not BYTE. Offsets within the 78B body:
    //   piercing ends at 57 -> m_bCharged DWORD @57; then m_iRandomOptItemId
    //   QWORD @61, m_dwKeepTime DWORD @69, bPet BYTE @73, m_bTranformVisPet
    //   DWORD @74. A 4B read at each must be 0 and the next field must start
    //   exactly after (m_bTranformVisPet ends at 78 = body length).
    const w = new PacketWriter();
    writeCItemElemBody(w, 0, { itemId: 1, count: 1 });
    const buf = w.build();
    assert.equal(buf.readUInt32LE(57), 0, 'm_bCharged BOOL @57');
    assert.equal(buf.readUInt32LE(74), 0, 'm_bTranformVisPet BOOL @74');
    assert.equal(buf.length, 78, 'two BOOL DWORDs land inside the 78B body');
  });

  it('encodes CItemBase header fields at their canonical offsets', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 7, { itemId: 1234, count: 1 });
    const buf = w.build();
    assert.equal(buf.readUInt32LE(0), 7, 'm_dwObjId = slot objid');
    assert.equal(buf.readUInt32LE(4), 1234, 'm_dwItemId');
    assert.equal(buf.readUInt32LE(8), 0, 'm_liSerialNumber (DWORD)');
    assert.equal(buf.readUInt32LE(12), 0, 'm_szItemText empty');
  });

  it('encodes count, flags, refine<<4, durability into CItemElem fields', () => {
    const slot: InventorySlot = { itemId: 9, count: 42, flags: 0x80, refine: 5, durability: 200 };
    const w = new PacketWriter();
    writeCItemElemBody(w, 0, slot);
    const buf = w.build();
    // CItemElem starts at byte 16: m_nItemNum(short)@16, m_nRepairNumber(BYTE)@18,
    // m_nHitPoint(int)@19, m_nRepair(int)@23, m_byFlag(BYTE)@27, m_nAbilityOption@28.
    assert.equal(buf.readInt16LE(16), 42, 'm_nItemNum = count');
    assert.equal(buf.readUInt32LE(19), 200, 'm_nHitPoint = durability');
    assert.equal(buf[27], 0x80, 'm_byFlag = flags');
    assert.equal(buf.readUInt32LE(28), 5 << 4, 'm_nAbilityOption = refine<<4');
  });

  it('writes durability -1 (indestructible) as 0 on the wire', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 0, { itemId: 1, count: 1, durability: -1 });
    const buf = w.build();
    assert.equal(buf.readUInt32LE(19), 0, 'negative durability -> 0');
  });

  it('defaults missing optional fields to 0 (plain drop)', () => {
    const w = new PacketWriter();
    writeCItemElemBody(w, 2, { itemId: 1, count: 1 });
    const buf = w.build();
    assert.equal(buf[27], 0, 'flags default 0');
    assert.equal(buf.readUInt32LE(28), 0, 'refine default 0');
    assert.equal(buf.readUInt32LE(19), 0, 'durability default -> 0');
  });
});
