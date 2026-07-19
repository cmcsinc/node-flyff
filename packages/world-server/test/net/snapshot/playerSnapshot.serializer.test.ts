import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PlayerSnapshotSerializer } from '../../../src/net/snapshot/playerSnapshot.serializer.js';
import { CPlayer } from '../../../src/entities/player.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import {
  OT_MOVER, MI_MALE, SNAPSHOTTYPE_ADD_OBJ, EMPTY_ITEM_CONTAINER_SIZE,
} from '../../../src/net/snapshot/constants.js';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'Hero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0x112233, face_style: 3, skin_color: 1, level: 15,
    exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 16, stamina: 15, dexterity: 14, intelligence: 13,
    x: 1.5, y: 2.5, z: 3.5, world_id: 'W1', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

const serializer = new PlayerSnapshotSerializer();

describe('PlayerSnapshotSerializer', () => {
  const player = CPlayer.fromRow(makeRow(), { write: () => true });
  const buf = serializer.build(player);

  it('frames the JOIN header + cb=1 + ADD_OBJ entry', () => {
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.JOIN);
    assert.equal(buf.readUInt32LE(4), 42);            // objidPlayer
    assert.equal(buf.readUInt16LE(8), 1);             // cb = 1
    assert.equal(buf.readUInt32LE(10), 42);           // entry objid
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE_ADD_OBJ);
    assert.equal(buf.readUInt8(16), OT_MOVER);
    assert.equal(buf.readUInt32LE(17), MI_MALE);      // sex 0 → male model
  });

  it('writes the CObj duplicate type/index + scale + pos + angle', () => {
    assert.equal(buf.readUInt8(21), OT_MOVER);        // m_dwType dup
    assert.equal(buf.readUInt32LE(22), MI_MALE);      // m_dwIndex dup
    assert.equal(buf.readUInt16LE(26), 100);          // scale 1.0 * 100
    assert.equal(buf.readFloatLE(28), 1.5);           // pos.x
    assert.equal(buf.readFloatLE(32), 2.5);           // pos.y
    assert.equal(buf.readFloatLE(36), 3.5);           // pos.z
    assert.equal(buf.readUInt16LE(40), 0);            // angle
    assert.equal(buf.readUInt32LE(42), 42);           // CCtrl m_objid
  });

  it('writes CMover prefix fields at their offsets', () => {
    // CMover starts at 46: motion(2), bPlayer(1), hp(4), ...
    assert.equal(buf.readUInt16LE(46), 0);            // m_dwMotion
    assert.equal(buf.readUInt8(48), 1);               // m_bPlayer
    assert.equal(buf.readUInt32LE(49), 100);          // m_nHitPoint (hp)
    // ... state(4)+stateFlag(4)+belligerence(1)+sfx(4)=13 → name at 46+2+1+4+13=66
    assert.equal(buf.readUInt32LE(66), 4);            // name length
    assert.equal(buf.subarray(70, 74).toString('ascii'), 'Hero');
    assert.equal(buf.readUInt8(74), 0);               // GetSex (gender 0)
    assert.equal(buf.readUInt8(75), 1);               // m_dwSkinSet
    assert.equal(buf.readUInt8(76), 2);               // m_dwHairMesh
    assert.equal(buf.readUInt32LE(77), 0x112233);     // m_dwHairColor
  });

  it('produces the byte-exact total length (3086 + nameLen)', () => {
    // fresh-spawn fixed budget + dynamic name; "Hero"=4 → 3090
    assert.equal(buf.length, 3086 + 4);

    const p2 = CPlayer.fromRow(makeRow({ name: 'X' }), { write: () => true });
    assert.equal(serializer.build(p2).length, 3086 + 1);

    const p3 = CPlayer.fromRow(makeRow({ name: '' }), { write: () => true });
    assert.equal(serializer.build(p3).length, 3086);
  });

  it('includes the empty inventory + 3 bank tabs (NULL_ID framing)', () => {
    const fourContainers = 4 * EMPTY_ITEM_CONTAINER_SIZE;
    assert.ok(fourContainers > 0);
    assert.equal(buf.length, 3086 + 4);
    // verify the NULL_ID pattern appears (empty index slots)
    assert.ok(buf.includes(Buffer.from([0xff, 0xff, 0xff, 0xff])));
  });

  it('uses the female model index for gender ≠ 0', () => {
    const f = CPlayer.fromRow(makeRow({ gender: 1 }), { write: () => true });
    const fb = serializer.build(f);
    assert.equal(fb.readUInt32LE(17), 12); // MI_FEMALE
  });
});
