import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  ReturnSaySerializer,
  RETURN_SELF_TARGET,
  RETURN_NOT_FOUND,
} from '../../../src/net/snapshot/returnSay.serializer';
import { NULL_ID, SNAPSHOTTYPE_RETURNSAY } from '@flyff/world-core';

describe('ReturnSaySerializer (SNAPSHOTTYPE_RETURNSAY 0x00a9)', () => {
  it('writes recipient objid + flag + name', () => {
    const buf = new ReturnSaySerializer().build(99, RETURN_NOT_FOUND, 'Ghost');
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), 99);
    assert.equal(r.readWord(), SNAPSHOTTYPE_RETURNSAY);
    assert.equal(r.readDword(), RETURN_NOT_FOUND);
    assert.equal(r.readString(), 'Ghost');
  });

  it('uses flag=2 for self-target', () => {
    const buf = new ReturnSaySerializer().build(1, RETURN_SELF_TARGET, ' ');
    const r = new PacketReader(buf);
    r.readDword(); r.readDword(); r.readWord(); r.readDword(); r.readWord();
    assert.equal(r.readDword(), RETURN_SELF_TARGET);
  });
});
