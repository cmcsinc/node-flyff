/**
 * SetPosSerializer wire-frame test — SNAPSHOT/SETPOS (0x0010) same-world teleport.
 * Frame: [SNAPSHOT][NULL_ID][cb=1][objid][0x0010][x f32][y f32][z f32].
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SetPosSerializer } from '../../../src/net/snapshot/setPos.serializer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';

const SNAPSHOT_OFFSET = 4; // [SNAPSHOT:DWORD][objidPlayer:DWORD][cb:WORD] = 10, objid at 10
// Layout: 0 SNAPSHOT(4) | 4 objidPlayer(4) | 8 cb(2) | 10 objid(4) | 14 hdr(2) | 16 x(4) | 20 y(4) | 24 z(4)

describe('SetPosSerializer', () => {
  it('builds SETPOS frame with objid + position (matches AddSetPos)', () => {
    const buf = new SetPosSerializer().build(0x0001002a, { x: 6978.5, y: 100, z: 3329 });

    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), 0xffffffff); // objidPlayer (unused, NULL_ID)
    assert.equal(buf.readUInt16LE(8), 1);          // cb = 1 entry
    assert.equal(buf.readUInt32LE(10), 0x0001002a); // GETID(pCtrl)
    assert.equal(buf.readUInt16LE(14), 0x0010);     // SNAPSHOTTYPE_SETPOS
    assert.equal(buf.readFloatLE(16), 6978.5);
    assert.equal(buf.readFloatLE(20), 100);
    assert.equal(buf.readFloatLE(24), 3329);
  });

  it('total body length is 28 bytes (header 16 + 3 floats)', () => {
    const buf = new SetPosSerializer().build(1, { x: 0, y: 0, z: 0 });
    assert.equal(buf.length, 28);
  });
});

void SNAPSHOT_OFFSET;
