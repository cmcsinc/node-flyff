/**
 * Skill-buff S->C serializers -- wire-format byte assertions for SETSKILLSTATE
 * (0x004c) and REMOVESKILLINFULENCE (0x00f8).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  buildSetSkillState,
  buildRemoveSkillInfluence,
  buildSetDestParam,
  buildResetDestParam,
  NULL_ID,
  SNAPSHOTTYPE_SETSKILLSTATE,
  SNAPSHOTTYPE_REMOVESKILLINFULENCE,
  SNAPSHOTTYPE_SETDESTPARAM,
  SNAPSHOTTYPE_RESETDESTPARAM,
} from '@flyff/world-core';

function readSnapshotHeader(buf: Buffer, r: PacketReader) {
  const op = r.readDword();
  const head = r.readDword();
  const count = r.readWord();
  const objid = r.readDword();
  const sub = r.readWord();
  return { op, head, count, objid, sub };
}

describe('buildSetSkillState (SNAPSHOTTYPE_SETSKILLSTATE 0x004c)', () => {
  it('writes objid | type:word | skillId:word | level:dword | remainMs:dword', () => {
    const buf = buildSetSkillState(42, 1, 150, 4, 30_000);
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(buf, r);
    assert.equal(h.op, PACKETTYPE.SNAPSHOT);
    assert.equal(h.head, NULL_ID);
    assert.equal(h.count, 1);
    assert.equal(h.objid, 42);
    assert.equal(h.sub, SNAPSHOTTYPE_SETSKILLSTATE);
    assert.equal(r.readWord(), 1);     // wType
    assert.equal(r.readWord(), 150);   // wID (skill id)
    assert.equal(r.readDword(), 4);    // dwLevel
    assert.equal(r.readDword(), 30_000); // dwTime (remaining ms)
  });
});

describe('buildRemoveSkillInfluence (SNAPSHOTTYPE_REMOVESKILLINFULENCE 0x00f8)', () => {
  it('writes objid | type:word | skillId:word', () => {
    const buf = buildRemoveSkillInfluence(42, 1, 150);
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(buf, r);
    assert.equal(h.op, PACKETTYPE.SNAPSHOT);
    assert.equal(h.head, NULL_ID);
    assert.equal(h.objid, 42);
    assert.equal(h.sub, SNAPSHOTTYPE_REMOVESKILLINFULENCE);
    assert.equal(r.readWord(), 1);     // wType
    assert.equal(r.readWord(), 150);   // wID (skill id)
  });
});

describe('buildSetDestParam (SNAPSHOTTYPE_SETDESTPARAM 0x001c)', () => {
  it('writes objid | dst:dword | adj:dword | chg:dword (sentinel default)', () => {
    const buf = buildSetDestParam(42, 4, 20); // +20 STA, additive
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(buf, r);
    assert.equal(h.sub, SNAPSHOTTYPE_SETDESTPARAM);
    assert.equal(r.readDword(), 4);              // DST_STA
    assert.equal(r.readDword(), 20);             // adj
    assert.equal(r.readDword(), 0x7fffffff);     // chg sentinel (no override)
  });

  it('writes an explicit chg override when provided', () => {
    const buf = buildSetDestParam(42, 35, 0, 999); // hard-set HP_MAX
    const r = new PacketReader(buf);
    readSnapshotHeader(buf, r); // consume the 16-byte snapshot header
    assert.equal(r.readDword(), 35);              // dst
    assert.equal(r.readDword(), 0);               // adj
    assert.equal(r.readDword(), 999);             // chg
  });
});

describe('buildResetDestParam (SNAPSHOTTYPE_RESETDESTPARAM 0x001d)', () => {
  it('writes objid | dst:dword | adj:dword', () => {
    const buf = buildResetDestParam(42, 4, 20);
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(buf, r);
    assert.equal(h.sub, SNAPSHOTTYPE_RESETDESTPARAM);
    assert.equal(r.readDword(), 4);   // DST_STA
    assert.equal(r.readDword(), 20);  // adj
  });
});
