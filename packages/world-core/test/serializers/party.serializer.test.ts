/**
 * party.serializer byte-layout tests -- asserts the exact wire widths so a
 * field-order regression can't silently crash the v19 client.
 * @module serializers/party.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildPartyMember, buildPartyRequest, buildPartyRequestCancel,
  buildPartyChangeLeader, buildPartyChat, buildPartyExp, buildErrorParty,
  MAX_PARTYMODE,
} from '../../src/serializers/party.serializer';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../../src/snapshot-constants';

/** Common 14-byte snapshot header: [SNAPSHOT:4][NULL_ID:4][count=1:2][objid:4][subtype:2]. */
function assertPrefix(buf: Buffer, recipientObjid: number, subtype: number): void {
  assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
  assert.equal(buf.readUInt32LE(4), NULL_ID);
  assert.equal(buf.readUInt16LE(8), 1);
  assert.equal(buf.readUInt32LE(10), recipientObjid);
  assert.equal(buf.readUInt16LE(14), subtype);
}

/** Read a DWORD-length-prefixed string at `off`; returns [str, nextOff]. */
function readStr(buf: Buffer, off: number): [string, number] {
  const len = buf.readUInt32LE(off);
  off += 4;
  const str = buf.subarray(off, off + len).toString('utf8');
  return [str, off + len];
}

describe('buildPartyMember (SNAPSHOTTYPE_PARTYMEMBER)', () => {
  it('prefix + body order/widths for a 2-member solo party', () => {
    const party = {
      partyId: 0x10, size: 2, expMode: 0, itemMode: 0,
      duelPartyId: NULL_ID,
      members: [{ id: 1, remove: false }, { id: 2, remove: false }],
    };
    const buf = buildPartyMember(7, 'Alice', 'Bob', party);
    assertPrefix(buf, 7, SNAPSHOTTYPE.PARTYMEMBER);
    let off = 16;
    // idPlayer (recipient objid echo).
    assert.equal(buf.readUInt32LE(off), 7); off += 4;
    // String leader.
    let s: [string, number];
    s = readStr(buf, off); assert.equal(s[0], 'Alice'); off = s[1];
    // String member.
    s = readStr(buf, off); assert.equal(s[0], 'Bob'); off = s[1];
    // int nSizeofMember.
    assert.equal(buf.readUInt32LE(off), 2); off += 4;
    // --- CParty::Serialize ---
    assert.equal(buf.readUInt32LE(off), 0x10); off += 4; // m_uPartyId
    assert.equal(buf.readUInt32LE(off), 0); off += 4;    // m_nKindTroup (solo)
    assert.equal(buf.readUInt32LE(off), 2); off += 4;    // m_nSizeofMember
    assert.equal(buf.readUInt32LE(off), 0); off += 4;    // m_nLevel
    assert.equal(buf.readUInt32LE(off), 0); off += 4;    // m_nExp
    assert.equal(buf.readUInt32LE(off), 0); off += 4;    // m_nPoint
    assert.equal(buf.readUInt32LE(off), 0); off += 4;    // m_nTroupsShareExp
    assert.equal(buf.readUInt32LE(off), 0); off += 4;    // m_nTroupeShareItem
    assert.equal(buf.readUInt32LE(off), NULL_ID); off += 4; // m_idDuelParty
    // m_nModeTime[5].
    for (let i = 0; i < MAX_PARTYMODE; i++) { assert.equal(buf.readUInt32LE(off), 0); off += 4; }
    // Per-member trailer (v19: u_long m_uPlayerId, BOOL m_bRemove).
    assert.equal(buf.readUInt32LE(off), 1); off += 4;
    assert.equal(buf.readUInt32LE(off), 0); off += 4;
    assert.equal(buf.readUInt32LE(off), 2); off += 4;
    assert.equal(buf.readUInt32LE(off), 0); off += 4;
    assert.equal(off, buf.length, 'no trailing bytes');
  });

  it('null party writes the int 0 size and skips Serialize', () => {
    const buf = buildPartyMember(9, 'X', 'Y', null);
    assertPrefix(buf, 9, SNAPSHOTTYPE.PARTYMEMBER);
    let off = 16 + 4; // prefix + idPlayer
    off = readStr(buf, off)[1]; // leader
    off = readStr(buf, off)[1]; // member
    assert.equal(buf.readUInt32LE(off), 0);
    assert.equal(off + 4, buf.length);
  });

  it('flags m_bRemove=TRUE when a member is marked departing', () => {
    const buf = buildPartyMember(1, 'L', 'M', {
      partyId: 5, size: 1, members: [{ id: 99, remove: true }],
    });
    // Last 8 bytes = [u_long playerId][BOOL remove].
    assert.equal(buf.readUInt32LE(buf.length - 8), 99);
    assert.equal(buf.readUInt32LE(buf.length - 4), 1);
  });
});

describe('buildPartyRequest (SNAPSHOTTYPE_PARTYREQEST)', () => {
  it('writes leader/member stat tuples + name + bTroup', () => {
    const buf = buildPartyRequest(20, 1, 15, 2, 0, 2, 12, 1, 1, 'Leader', 0);
    assertPrefix(buf, 20, SNAPSHOTTYPE.PARTYREQEST);
    let off = 16;
    assert.equal(buf.readUInt32LE(off), 1); off += 4;   // leaderId
    assert.equal(buf.readUInt32LE(off), 15); off += 4;  // lLv
    assert.equal(buf.readUInt32LE(off), 2); off += 4;   // lJob
    assert.equal(buf.readUInt32LE(off), 0); off += 4;   // lSex (BYTE widened to LONG)
    assert.equal(buf.readUInt32LE(off), 2); off += 4;   // memberId
    assert.equal(buf.readUInt32LE(off), 12); off += 4;
    assert.equal(buf.readUInt32LE(off), 1); off += 4;
    assert.equal(buf.readUInt32LE(off), 1); off += 4;
    const s = readStr(buf, off); assert.equal(s[0], 'Leader'); off = s[1];
    assert.equal(buf.readUInt32LE(off), 0); off += 4;   // bTroup
    assert.equal(off, buf.length);
  });
});

describe('buildPartyChat (SNAPSHOTTYPE_PARTYCHAT)', () => {
  it('writes objid + name + msg', () => {
    const buf = buildPartyChat(30, 'Alice', 'hi', 42);
    assertPrefix(buf, 30, SNAPSHOTTYPE.PARTYCHAT);
    let off = 16;
    assert.equal(buf.readUInt32LE(off), 42); off += 4;  // objid
    let s = readStr(buf, off); assert.equal(s[0], 'Alice'); off = s[1];
    s = readStr(buf, off); assert.equal(s[0], 'hi'); off = s[1];
    assert.equal(off, buf.length);
  });
});

describe('remaining party serializers', () => {
  it('buildPartyRequestCancel writes leader+member+mode', () => {
    const buf = buildPartyRequestCancel(3, 1, 2, 0);
    assertPrefix(buf, 3, SNAPSHOTTYPE.PARTYREQESTCANCEL);
    assert.equal(buf.readUInt32LE(16), 1);
    assert.equal(buf.readUInt32LE(20), 2);
    assert.equal(buf.readUInt32LE(24), 0);
    assert.equal(buf.length, 28);
  });

  it('buildPartyChangeLeader writes the new leader objid', () => {
    const buf = buildPartyChangeLeader(4, 99);
    assertPrefix(buf, 4, SNAPSHOTTYPE.ADDPARTYCHANGELEADER);
    assert.equal(buf.readUInt32LE(16), 99);
    assert.equal(buf.length, 20);
  });

  it('buildPartyExp writes exp/level/point', () => {
    const buf = buildPartyExp(5, 1000, 2, 3);
    assertPrefix(buf, 5, SNAPSHOTTYPE.PARTYEXP);
    assert.equal(buf.readUInt32LE(16), 1000);
    assert.equal(buf.readUInt32LE(20), 2);
    assert.equal(buf.readUInt32LE(24), 3);
    assert.equal(buf.length, 28);
  });

  it('buildErrorParty writes dw only when dwSkill omitted', () => {
    const buf = buildErrorParty(6, 7);
    assertPrefix(buf, 6, SNAPSHOTTYPE.ERRORPARTY);
    assert.equal(buf.readUInt32LE(16), 7);
    assert.equal(buf.length, 20);
  });

  it('buildErrorParty appends dwSkill when provided', () => {
    const buf = buildErrorParty(6, 1, 999);
    assert.equal(buf.readUInt32LE(16), 1);
    assert.equal(buf.readUInt32LE(20), 999);
    assert.equal(buf.length, 24);
  });
});
