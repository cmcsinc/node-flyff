/**
 * DOEQUIP serializer byte-layout test.
 *
 * Pins the two equip-confirm snapshots. The #1 equip wire risk is EQUIP_INFO:
 * `{DWORD dwId, int nOption, BYTE byFlag}` is 9 logical bytes but MSVC pads the
 * struct to 12 — the 3 trailing pad bytes must be written literal zero or the
 * vicinity stream desyncs (nPart reads garbage) and Neuz crashes.
 *
 * Self (`User.cpp:1197`):     22 B — objid + 0x0006 + nId + dwItemId + fEquip
 * Vicinity (`User.cpp:4515`): 38 B — adds idGuild + EQUIP_INFO(12) + nPart
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID } from '../../../src/net/snapshot/constants.js';
import {
  buildDoEquipSelf,
  buildDoEquipVicinity,
} from '../../../src/net/snapshot/doEquip.serializer.js';

describe('buildDoEquipSelf', () => {
  it('produces a 22 B frame with the AddDoEquip self layout', () => {
    const buf = buildDoEquipSelf(0x0000aaaa, 4, 2950, true);
    assert.equal(buf.length, 22, 'self DOEQUIP = 22 bytes');
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1, 'cb = 1');
    assert.equal(buf.readUInt32LE(10), 0x0000aaaa, 'objid');
    assert.equal(buf.readUInt16LE(14), 0x0006, 'SNAPSHOTTYPE_DOEQUIP');
    assert.equal(buf[16], 4, 'nId = inv slot');
    assert.equal(buf.readUInt32LE(17), 2950, 'dwItemId');
    assert.equal(buf[21], 1, 'fEquip = 1 (equipping)');
  });

  it('writes fEquip=0 for unequip', () => {
    const buf = buildDoEquipSelf(1, 9, 0, false);
    assert.equal(buf[21], 0, 'fEquip = 0 (unequipping)');
  });
});

describe('buildDoEquipVicinity', () => {
  it('produces a 38 B frame with 12 B EQUIP_INFO padding (3 zero pad bytes)', () => {
    const buf = buildDoEquipVicinity(
      0x0000bbbb,
      4,
      true,
      { dwId: 2950, nOption: 0x50, byFlag: 0x01 },
      9, // nPart = LWEAPON
    );

    assert.equal(buf.length, 38, 'vicinity DOEQUIP = 38 bytes (EQUIP_INFO padded to 12)');

    // Header + prefix
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(10), 0x0000bbbb, 'objid');
    assert.equal(buf.readUInt16LE(14), 0x0006);
    assert.equal(buf[16], 4, 'nId');
    assert.equal(buf.readUInt32LE(17), 0, 'idGuild hardcoded 0');
    assert.equal(buf[21], 1, 'fEquip');

    // EQUIP_INFO 12 B block starts at offset 22.
    assert.equal(buf.readUInt32LE(22), 2950, 'EQUIP_INFO.dwId');
    assert.equal(buf.readInt32LE(26), 0x50, 'EQUIP_INFO.nOption (signed int)');
    assert.equal(buf[30], 0x01, 'EQUIP_INFO.byFlag');
    // The 3 MSVC pad bytes — the regression that crashes Neuz if omitted.
    assert.equal(buf[31], 0, 'pad byte 1');
    assert.equal(buf[32], 0, 'pad byte 2');
    assert.equal(buf[33], 0, 'pad byte 3');

    // nPart follows immediately after the 12-byte struct.
    assert.equal(buf.readInt32LE(34), 9, 'nPart = LWEAPON');
  });
});
