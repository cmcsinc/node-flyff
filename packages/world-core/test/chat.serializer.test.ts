import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { ChatSerializer } from '../src/serializers/chat.serializer';
import { NULL_ID, SNAPSHOTTYPE_CHAT } from '@flyff/world-core';

function readSnapshotHeader(buf: Buffer, r: PacketReader) {
  const op = r.readDword();
  const head = r.readDword();
  const count = r.readWord();
  const objid = r.readDword();
  const sub = r.readWord();
  return { op, head, count, objid, sub };
}

describe('ChatSerializer (SNAPSHOTTYPE_CHAT 0x0001)', () => {
  it('writes objid + text only -- no name/job/level', () => {
    const buf = new ChatSerializer().build(42, 'hi');
    const r = new PacketReader(buf);
    const h = readSnapshotHeader(buf, r);
    assert.equal(h.op, PACKETTYPE.SNAPSHOT);
    assert.equal(h.head, NULL_ID);
    assert.equal(h.count, 1);
    assert.equal(h.objid, 42);
    assert.equal(h.sub, SNAPSHOTTYPE_CHAT);
    assert.equal(r.readString(), 'hi');
    // Snapshot header (4+4+2+4+2 = 16) + opcode DWORD 4 + string DWORD 4 + 2 chars = 26
    assert.equal(buf.length, 16 + 4 + 2);
  });
});
