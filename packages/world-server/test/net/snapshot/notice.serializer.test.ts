import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NoticeSerializer } from '../../../src/net/snapshot/notice.serializer.js';
import {
  NULL_ID,
  SNAPSHOTTYPE_TEXT,
  TEXT_COLOR_NOTICE,
  TEXT_GENERAL,
} from '../../../src/net/snapshot/constants.js';

describe('NoticeSerializer (SNAPSHOTTYPE_TEXT 0x00a0)', () => {
  it('writes the TEXT_GENERAL state byte before text + color (__S_SERVER_UNIFY)', () => {
    // Florist defines __S_SERVER_UNIFY, so AddText emits BYTE nState between the
    // subtype and the string (User.cpp:660). OnText reads it before the string.
    const buf = new NoticeSerializer().build('reboot soon');
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), SNAPSHOTTYPE_TEXT);
    assert.equal(r.readByte(), TEXT_GENERAL);
    assert.equal(r.readString(), 'reboot soon');
    assert.equal(r.readDword(), TEXT_COLOR_NOTICE);
  });
});
