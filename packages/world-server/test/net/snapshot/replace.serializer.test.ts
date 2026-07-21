import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { ReplaceSerializer } from '../../../src/net/snapshot/replace.serializer.js';
import { NULL_ID, SNAPSHOTTYPE_REPLACE } from '../../../src/net/snapshot/constants.js';

describe('ReplaceSerializer (SNAPSHOTTYPE_REPLACE 0x00f2)', () => {
  it('writes worldId DWORD + 3 floats under a NULL_ID header', () => {
    const buf = new ReplaceSerializer().build(1, { x: 10.5, y: 0, z: -20.25 });
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), SNAPSHOTTYPE_REPLACE);
    assert.equal(r.readDword(), 1);
    assert.equal(r.readFloat(), 10.5);
    assert.equal(r.readFloat(), 0);
    assert.equal(r.readFloat(), -20.25);
  });
});
