import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PlayerSnapshotSerializer } from '../../../src/net/snapshot/playerSnapshot.serializer';
import { CPlayer } from '../../../src/entities/player';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  OT_MOVER, MI_MALE, SNAPSHOTTYPE_ADD_OBJ,
  SNAPSHOTTYPE_WORLD_READINFO, WI_WORLD_MADRIGAL,
  INVENTORY_SLOTS, BANK_SLOTS, emptyItemContainerSize,
} from '../../../src/net/snapshot/constants';
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

  it('frames the JOIN header + cb=2 + WORLD_READINFO + ADD_OBJ entry', () => {
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.JOIN);
    assert.equal(buf.readUInt32LE(4), 42);            // objidPlayer
    assert.equal(buf.readUInt16LE(8), 2);             // cb = 2 sub-records
    // WORLD_READINFO sub-record (22 bytes: objid+hdr+dwWorldId+vPos)
    assert.equal(buf.readUInt32LE(10), 42);           // objid
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE_WORLD_READINFO);
    assert.equal(buf.readUInt32LE(16), WI_WORLD_MADRIGAL); // dwWorldId
    assert.equal(buf.readFloatLE(20), 1.5);           // vPos.x
    assert.equal(buf.readFloatLE(24), 2.5);           // vPos.y
    assert.equal(buf.readFloatLE(28), 3.5);           // vPos.z
    // ADD_OBJ entry starts at 32 (10 + 22)
    assert.equal(buf.readUInt32LE(32), 42);           // entry objid
    assert.equal(buf.readUInt16LE(36), SNAPSHOTTYPE_ADD_OBJ);
    assert.equal(buf.readUInt8(38), OT_MOVER);
    assert.equal(buf.readUInt32LE(39), MI_MALE);      // sex 0 -> male model
  });

  it('writes the CObj duplicate type/index + scale + pos + angle', () => {
    assert.equal(buf.readUInt8(43), OT_MOVER);        // m_dwType dup
    assert.equal(buf.readUInt32LE(44), MI_MALE);      // m_dwIndex dup
    assert.equal(buf.readUInt16LE(48), 100);          // scale 1.0 * 100
    assert.equal(buf.readFloatLE(50), 1.5);           // pos.x
    assert.equal(buf.readFloatLE(54), 2.5);           // pos.y
    assert.equal(buf.readFloatLE(58), 3.5);           // pos.z
    assert.equal(buf.readUInt16LE(62), 0);            // angle
    assert.equal(buf.readUInt32LE(64), 42);           // CCtrl m_objid
  });

  it('writes CMover prefix fields at their offsets', () => {
    // CMover starts at 68 (46 + 22 WORLD_READINFO): motion(2), bPlayer(1), hp(4), ...
    assert.equal(buf.readUInt16LE(68), 0);            // m_dwMotion
    assert.equal(buf.readUInt8(70), 1);               // m_bPlayer
    assert.equal(buf.readUInt32LE(71), 100);          // m_nHitPoint (hp)
    // ... state(4)+stateFlag(4)+belligerence(1)+sfx(4)=13 -> name at 68+2+1+4+13=88
    assert.equal(buf.readUInt32LE(88), 4);            // name length
    assert.equal(buf.subarray(92, 96).toString('ascii'), 'Hero');
    assert.equal(buf.readUInt8(96), 0);               // GetSex (gender 0)
    assert.equal(buf.readUInt8(97), 1);               // m_dwSkinSet
    assert.equal(buf.readUInt8(98), 2);               // m_dwHairMesh
    assert.equal(buf.readUInt32LE(99), 0x112233);     // m_dwHairColor
  });

  it('produces the byte-exact total length (3350 + nameLen)', () => {
    // fresh-spawn fixed budget + dynamic name; "Hero"=4 -> 3354.
    // Base 3350 = 3328 (CMover blob) + 22 (WORLD_READINFO sub-record:
    // objid 4 + hdr 2 + dwWorldId 4 + vPos 12). CMover base 3328 = 3086
    // + 248 (inventory 42->73 slots) + 12 (3 EXPINTEGER exp fields 4->8)
    // - 9 (3 resist BYTE not DWORD) - 9 (3 quest-size BYTE not DWORD).
    assert.equal(buf.length, 3350 + 4);

    const p2 = CPlayer.fromRow(makeRow({ name: 'X' }), { write: () => true });
    assert.equal(serializer.build(p2).length, 3350 + 1);

    const p3 = CPlayer.fromRow(makeRow({ name: '' }), { write: () => true });
    assert.equal(serializer.build(p3).length, 3350);
  });

  it('includes the empty inventory + 3 bank tabs (NULL_ID framing)', () => {
    const containers =
      emptyItemContainerSize(INVENTORY_SLOTS) + // m_Inventory: 73 slots
      3 * emptyItemContainerSize(BANK_SLOTS);   // m_Bank *3: 42 slots each
    assert.ok(containers > 0);
    assert.equal(buf.length, 3350 + 4);
    // verify the NULL_ID pattern appears (empty index slots)
    assert.ok(buf.includes(Buffer.from([0xff, 0xff, 0xff, 0xff])));
  });

  it('uses the female model index for gender != 0', () => {
    const f = CPlayer.fromRow(makeRow({ gender: 1 }), { write: () => true });
    const fb = serializer.build(f);
    assert.equal(fb.readUInt32LE(39), 12); // MI_FEMALE (ADD_OBJ dwObjIndex, +22 for WORLD_READINFO)
  });
});
