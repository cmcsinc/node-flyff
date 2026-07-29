import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NoticeSerializer, buildGoldText } from '../../../src/net/snapshot/notice.serializer';
import {
  NULL_ID,
  SNAPSHOTTYPE_TEXT,
  SNAPSHOTTYPE_DEFINEDTEXT,
  TEXT_COLOR_NOTICE,
  TEXT_GENERAL,
  TID_GAME_REAPMONEY,
} from '@flyff/world-core';

describe('NoticeSerializer (SNAPSHOTTYPE_TEXT 0x00a0)', () => {
  it('writes the TEXT_GENERAL state byte before text + color (__S_SERVER_UNIFY)', () => {
    // __S_SERVER_UNIFY is defined, so AddText emits BYTE nState between the
    // subtype and the string (game/source/WORLDSERVER/User.cpp:681).
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

describe('buildGoldText (SNAPSHOTTYPE_DEFINEDTEXT 0x0095)', () => {
  it('emits objid, TID_GAME_REAPMONEY and comma-formatted "plus total" with no state byte/color', () => {
    // CUser::AddDefinedText (User.cpp:2200) writes GetId() | subtype | DWORD id
    // | String args -- no nState byte, no trailing color DWORD.
    const buf = buildGoldText(0x1234, 1234, 56789);
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), 0x1234);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), 0x1234);
    assert.equal(r.readWord(), SNAPSHOTTYPE_DEFINEDTEXT);
    assert.equal(r.readDword(), TID_GAME_REAPMONEY);
    // OnDefinedText splits on a single space into exactly 2 args; commas come
    // from GetNumberFormatEx and must NOT be used as separators.
    assert.equal(r.readString(), '1,234 56,789');
  });
});
