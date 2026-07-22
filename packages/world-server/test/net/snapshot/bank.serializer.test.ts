/**
 * Bank S->C serializer byte-layout test.
 *
 * Pins `CUser::AddPutItemBank` / `AddGetItemBank` / `AddPutGoldBank` /
 * `AddBankWindow` (`User.cpp:965-1034`). All wrap a per-user snapshot frame
 * (SNAPSHOT + NULL_ID + cb=1 + objid + subtype) then the type-specific fields.
 * Item acks reuse the 78-byte CItemElem body.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID } from '../../../src/net/snapshot/constants.js';
import {
  buildPutItemBank,
  buildGetItemBank,
  buildPutGoldBank,
  buildGetGoldBank,
  buildBankWindow,
} from '../../../src/net/snapshot/bank.serializer.js';

const HDR = PACKETTYPE.SNAPSHOT;

describe('buildPutItemBank', () => {
  it('produces a 95 B frame: frame(16) + tab(1) + CItemElem body(78)', () => {
    const buf = buildPutItemBank(0x0000cccc, 1, 3, { itemId: 2950, count: 2 });
    assert.equal(buf.length, 95);
    assert.equal(buf.readUInt32LE(0), HDR);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1, 'cb = 1');
    assert.equal(buf.readUInt32LE(10), 0x0000cccc, 'objid');
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.PUTITEMBANK, '0x0050');
    assert.equal(buf[16], 1, 'tab byte');
    // CItemElem body follows: objId(=bankSlot) then itemId.
    assert.equal(buf.readUInt32LE(17), 3, 'body m_dwObjId = bankSlot');
    assert.equal(buf.readUInt32LE(21), 2950, 'body m_dwItemId');
    assert.equal(buf.readInt16LE(33), 2, 'body m_nItemNum = count');
  });
});

describe('buildGetItemBank', () => {
  it('produces a 94 B frame: frame(16) + CItemElem body(78) (no tab byte)', () => {
    const buf = buildGetItemBank(0x0000dddd, 7, { itemId: 1234, count: 1 });
    assert.equal(buf.length, 94);
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.GETITEMBANK, '0x0051');
    assert.equal(buf.readUInt32LE(16), 7, 'body m_dwObjId = invSlot');
    assert.equal(buf.readUInt32LE(20), 1234, 'body m_dwItemId');
  });
});

describe('buildPutGoldBank', () => {
  it('produces a 25 B frame: frame(16) + tab(1) + dwGold(4) + dwGoldBank(4)', () => {
    const buf = buildPutGoldBank(0x0000eeee, 0, 500, 1500);
    assert.equal(buf.length, 25);
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.PUTGOLDBANK, '0x0052');
    assert.equal(buf[16], 0, 'tab byte');
    assert.equal(buf.readUInt32LE(17), 500, 'dwGold = inv remainder');
    assert.equal(buf.readUInt32LE(21), 1500, 'dwGoldBank = new bank total');
  });
});

describe('buildGetGoldBank', () => {
  it('shares the PUTGOLDBANK layout', () => {
    const buf = buildGetGoldBank(0x0000ffff, 0, 100, 400);
    assert.equal(buf.length, 25);
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.PUTGOLDBANK);
    assert.equal(buf.readUInt32LE(17), 100);
    assert.equal(buf.readUInt32LE(21), 400);
  });
});

describe('buildBankWindow', () => {
  it('produces a 28 B frame: frame(16) + nMode(4) + dwId(4) + dwItemId(4)', () => {
    const buf = buildBankWindow(0x00001111, 1, NULL_ID, 0);
    assert.equal(buf.length, 28);
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.BANKWINDOW, '0x0056');
    assert.equal(buf.readUInt32LE(16), 1, 'nMode = open');
    assert.equal(buf.readUInt32LE(20), NULL_ID, 'dwId = NULL_ID (NPC bank)');
    assert.equal(buf.readUInt32LE(24), 0, 'dwItemId');
  });
});
