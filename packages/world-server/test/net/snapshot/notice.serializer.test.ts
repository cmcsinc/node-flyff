import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NoticeSerializer } from '../../../src/net/snapshot/notice.serializer.js';
import {
  NULL_ID,
  SNAPSHOTTYPE_TEXT,
  TEXT_COLOR_NOTICE,
} from '../../../src/net/snapshot/constants.js';

describe('NoticeSerializer (SNAPSHOTTYPE_TEXT 0x00a0)', () => {
  it('writes text + color (no TEXT_GENERAL byte — __S_SERVER_UNIFY off)', () => {
    const buf = new NoticeSerializer().build('reboot soon');
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), SNAPSHOTTYPE_TEXT);
    assert.equal(r.readString(), 'reboot soon');
    assert.equal(r.readDword(), TEXT_COLOR_NOTICE);
  });
});
