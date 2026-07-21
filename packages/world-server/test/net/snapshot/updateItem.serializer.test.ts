/**
 * UPDATE_ITEM serializer byte-layout test.
 *
 * Pins `CUser::AddUpdateItem` (`User.cpp:1089`):
 *   SNAPSHOT hdr + `[objid][0x0018][BYTE cType][BYTE nId][CHAR cParam]
 *   [DWORD dwValue][DWORD dwTime]` = 27 B total. Used for stack-count deltas on
 *   an EXISTING slot (CREATEITEM is for new slots only).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID } from '../../../src/net/snapshot/constants.js';
import { buildUpdateItemCount } from '../../../src/net/snapshot/updateItem.serializer.js';

describe('buildUpdateItemCount', () => {
  it('produces a 27 B frame with the AddUpdateItem layout', () => {
    const buf = buildUpdateItemCount(0x0000dead, 6, 99);

    assert.equal(buf.length, 27, 'one-slot UPDATE_ITEM = 27 bytes');

    // SNAPSHOT header
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1, 'cb = 1 sub-snapshot');

    // Sub-snapshot body
    assert.equal(buf.readUInt32LE(10), 0x0000dead, 'player objid');
    assert.equal(buf.readUInt16LE(14), 0x0018, 'SNAPSHOTTYPE_UPDATE_ITEM');
    assert.equal(buf[16], 0, 'cType = inventory container');
    assert.equal(buf[17], 6, 'nId = slot');
    assert.equal(buf[18], 0, 'cParam = UI_NUM (count)');
    assert.equal(buf.readUInt32LE(19), 99, 'dwValue = new count');
    assert.equal(buf.readUInt32LE(23), 0, 'dwTime trailing');
  });
});
