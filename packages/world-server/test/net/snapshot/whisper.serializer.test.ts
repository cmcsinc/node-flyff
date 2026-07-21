import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { WhisperSerializer } from '../../../src/net/snapshot/whisper.serializer.js';

describe('WhisperSerializer (PACKETTYPE_WHISPER top-level)', () => {
  it('writes fromName, toName, msg, fromId, toId, search', () => {
    const buf = new WhisperSerializer().build({
      fromName: 'Alice',
      toName: 'Bob',
      text: 'hello',
      fromId: 1,
      toId: 2,
    });
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.WHISPER);
    assert.equal(r.readString(), 'Alice');
    assert.equal(r.readString(), 'Bob');
    assert.equal(r.readString(), 'hello');
    assert.equal(r.readDword(), 1);
    assert.equal(r.readDword(), 2);
    assert.equal(r.readDword(), 0, 'search defaults to 0 (online)');
  });
});
