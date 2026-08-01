/**
 * Kick notice wire-frame test -- SNAPSHOT/SEALCHARGET_REQ (0x0145).
 *
 * Frame: [SNAPSHOT][objid][cb=1][objid][0x0145]. No payload after the sub-type
 * (`CUser::AddSealCharSet`, WORLDSERVER/User.cpp:8040). A trailing byte would
 * desync the client's snapshot loop for every entry after this one.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildKickNotice, SNAPSHOTTYPE_SEALCHARGET_REQ } from '../../../src/net/snapshot/kick.serializer';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';

describe('buildKickNotice', () => {
  it('builds the SEALCHARGET_REQ frame with the player objid twice', () => {
    const buf = buildKickNotice(0x0001002a);

    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), 0x0001002a);  // objidPlayer -- C++ GetId()
    assert.equal(buf.readUInt16LE(8), 1);           // cb = 1 entry
    assert.equal(buf.readUInt32LE(10), 0x0001002a); // entry objid
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE_SEALCHARGET_REQ);
  });

  it('is exactly 16 bytes -- no payload after the sub-type', () => {
    assert.equal(buildKickNotice(1).length, 16);
  });

  it('pins the sub-type to MsgHdr.h:1233', () => {
    assert.equal(SNAPSHOTTYPE_SEALCHARGET_REQ, 0x0145);
  });
});
