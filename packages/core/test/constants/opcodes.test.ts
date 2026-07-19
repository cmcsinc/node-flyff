import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  PACKETTYPE,
  SNAPSHOTTYPE,
  lookupPacketType,
  lookupSnapshotType,
} from '../../src/constants/opcodes.js';

describe('PACKETTYPE opcodes', () => {
  it('CERTIFY equals 0xFC', () => {
    assert.equal(PACKETTYPE.CERTIFY, 0xfc);
  });

  it('SRVR_LIST equals 0xFD', () => {
    assert.equal(PACKETTYPE.SRVR_LIST, 0xfd);
  });

  it('JOIN equals 0xFF00', () => {
    assert.equal(PACKETTYPE.JOIN, 0xff00);
  });

  it('PRE_JOIN equals 0xFF05', () => {
    assert.equal(PACKETTYPE.PRE_JOIN, 0xff05);
  });

  it('GETPLAYERLIST equals 0xF6', () => {
    assert.equal(PACKETTYPE.GETPLAYERLIST, 0xf6);
  });

  it('PLAYER_LIST equals 0xF3', () => {
    assert.equal(PACKETTYPE.PLAYER_LIST, 0xf3);
  });

  it('CACHE_ADDR equals 0xF2', () => {
    assert.equal(PACKETTYPE.CACHE_ADDR, 0xf2);
  });

  it('CHAT equals 0x00FF0000', () => {
    assert.equal(PACKETTYPE.CHAT, 0x00ff0000);
  });

  it('SNAPSHOT equals 0xFFFFFF00', () => {
    assert.equal(PACKETTYPE.SNAPSHOT, 0xffffff00);
  });

  it('ADDOBJ equals 0x00FF0002', () => {
    assert.equal(PACKETTYPE.ADDOBJ, 0x00ff0002);
  });

  it('REMOVEOBJ equals 0x00FF0003', () => {
    assert.equal(PACKETTYPE.REMOVEOBJ, 0x00ff0003);
  });

  it('all values are unique', () => {
    const values = Object.values(PACKETTYPE);
    const set = new Set(values);
    assert.equal(set.size, values.length, 'Duplicate opcode values detected');
  });
});

describe('SNAPSHOTTYPE opcodes', () => {
  it('SETPOS equals 0x0010', () => {
    assert.equal(SNAPSHOTTYPE.SETPOS, 0x0010);
  });

  it('UPDATE_MOVER equals 0x0017', () => {
    assert.equal(SNAPSHOTTYPE.UPDATE_MOVER, 0x0017);
  });

  it('all values fit in 16-bit', () => {
    for (const [key, val] of Object.entries(SNAPSHOTTYPE)) {
      assert.ok(val >= 0 && val <= 0xffff, `${key} out of WORD range`);
    }
  });
});

describe('lookupPacketType', () => {
  it('finds CERTIFY by value', () => {
    assert.equal(lookupPacketType(0xfc), 'CERTIFY');
  });

  it('returns undefined for unknown', () => {
    assert.equal(lookupPacketType(0xdeadbeef), undefined);
  });
});

describe('lookupSnapshotType', () => {
  it('finds SETPOS by value', () => {
    assert.equal(lookupSnapshotType(0x0010), 'SETPOS');
  });
});
