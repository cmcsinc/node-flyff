/**
 * Action-slot S->C serializers -- wire-format byte assertions for ENDSKILLQUEUE
 * (0x00e5, bodyless) and SETACTIONPOINT (0x00c5, int nAP).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  buildEndSkillQueue,
  buildSetActionPoint,
  NULL_ID,
  SNAPSHOTTYPE_ENDSKILLQUEUE,
  SNAPSHOTTYPE_SETACTIONPOINT,
} from '@flyff/world-core';

function readSnapshotHeader(r: PacketReader) {
  const op = r.readDword();
  const head = r.readDword();
  const count = r.readWord();
  const objid = r.readDword();
  const sub = r.readWord();
  return { op, head, count, objid, sub };
}

describe('buildEndSkillQueue (SNAPSHOTTYPE_ENDSKILLQUEUE 0x00e5)', () => {
  it('writes the bodyless self-only header objid | 0x00e5', () => {
    const buf = buildEndSkillQueue(42);
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(r);
    assert.equal(h.op, PACKETTYPE.SNAPSHOT);
    assert.equal(h.head, NULL_ID);
    assert.equal(h.count, 1);
    assert.equal(h.objid, 42);
    assert.equal(h.sub, SNAPSHOTTYPE_ENDSKILLQUEUE);
    // No payload -- the snapshot ends after the sub-type word.
    assert.equal(r.remaining, 0);
  });
});

describe('buildSetActionPoint (SNAPSHOTTYPE_SETACTIONPOINT 0x00c5)', () => {
  it('writes objid | 0x00c5 | int nAP', () => {
    const buf = buildSetActionPoint(42, 86);
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(r);
    assert.equal(h.op, PACKETTYPE.SNAPSHOT);
    assert.equal(h.head, NULL_ID);
    assert.equal(h.count, 1);
    assert.equal(h.objid, 42);
    assert.equal(h.sub, SNAPSHOTTYPE_SETACTIONPOINT);
    assert.equal(r.readDword(), 86);
    assert.equal(r.remaining, 0);
  });
});
