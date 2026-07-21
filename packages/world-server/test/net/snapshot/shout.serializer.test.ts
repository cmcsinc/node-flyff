import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { ShoutSerializer } from '../../../src/net/snapshot/shout.serializer.js';
import {
  NULL_ID,
  SNAPSHOTTYPE_SHOUT,
  SHOUT_COLOR_DEFAULT,
} from '../../../src/net/snapshot/constants.js';

describe('ShoutSerializer (SNAPSHOTTYPE_SHOUT 0x00d0)', () => {
  it('writes senderObjid + name + text + color under a NULL_ID header', () => {
    const buf = new ShoutSerializer().build({
      senderObjid: 7,
      senderName: 'Bob',
      text: 'hi all',
    });
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), NULL_ID); // header objid — broadcast
    assert.equal(r.readWord(), SNAPSHOTTYPE_SHOUT);
    assert.equal(r.readDword(), 7);
    assert.equal(r.readString(), 'Bob');
    assert.equal(r.readString(), 'hi all');
    assert.equal(r.readDword(), SHOUT_COLOR_DEFAULT);
  });

  it('honors a custom color', () => {
    const buf = new ShoutSerializer().build({
      senderObjid: 1,
      senderName: 'A',
      text: 'x',
      color: 0xff00ff00,
    });
    // skip to the trailing color DWORD
    const r = new PacketReader(buf);
    r.readDword(); r.readDword(); r.readWord(); r.readDword(); r.readWord();
    r.readDword(); r.readString(); r.readString();
    assert.equal(r.readDword(), 0xff00ff00);
  });
});
