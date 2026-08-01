/**
 * naviPoint.serializer byte-layout test -- guards the `AddSetNaviPoint` body
 * (`User.cpp:2559`): three LE floats then a DWORD-prefixed name, with the
 * PINGER's objid in the record header (not the recipient's).
 * @module serializers/naviPoint.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildSetNaviPoint } from '../../src/serializers/naviPoint.serializer';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../../src/snapshot-constants';

describe('buildSetNaviPoint (SNAPSHOTTYPE_SETNAVIPOINT)', () => {
  it('writes prefix + Pos(3 floats) + name, and nothing else', () => {
    const buf = buildSetNaviPoint(0x1234, { x: 6900.5, y: 100.25, z: -1234.75 }, 'Pinger');

    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1);
    assert.equal(buf.readUInt32LE(10), 0x1234, 'record objid = pinger');
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE.SETNAVIPOINT);

    assert.equal(buf.readFloatLE(16), 6900.5);
    assert.equal(buf.readFloatLE(20), 100.25);
    assert.equal(buf.readFloatLE(24), -1234.75);

    assert.equal(buf.readUInt32LE(28), 6);
    assert.equal(buf.subarray(32, 38).toString('ascii'), 'Pinger');
    // No trailing `nv.On` -- it is commented out in User.cpp:2565.
    assert.equal(buf.length, 38);
  });
});
