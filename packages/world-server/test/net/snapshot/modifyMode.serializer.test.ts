import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { ModifyModeSerializer } from '../../../src/net/snapshot/modifyMode.serializer.js';
import {
  NULL_ID,
  SNAPSHOTTYPE_MODIFYMODE,
} from '../../../src/net/snapshot/constants.js';

describe('ModifyModeSerializer (SNAPSHOTTYPE_MODIFYMODE 0x00d3)', () => {
  it('writes objid + the full new m_dwMode bitmask', () => {
    const objid = 0x00010020;
    const dwMode = 0x00000021; // MATCHLESS | MATCHLESS2
    const buf = new ModifyModeSerializer().build(objid, dwMode);
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), objid);
    assert.equal(r.readWord(), SNAPSHOTTYPE_MODIFYMODE);
    assert.equal(r.readDword(), dwMode);
  });
});
