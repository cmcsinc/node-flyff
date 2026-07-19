import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PlayerListSerializer } from '../../src/net/playerList.serializer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { CharacterRow } from '@flyff/database';

function makeChar(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1,
    account_id: 10,
    name: 'Hero',
    slot: 0,
    class: 0,
    gender: 0, // male
    hair_style: 1,
    hair_color: 2,
    face_style: 3,
    skin_color: 4,
    level: 15,
    exp: BigInt(0),
    hp: 100,
    mp: 50,
    max_hp: 100,
    max_mp: 50,
    strength: 20,
    stamina: 18,
    dexterity: 16,
    intelligence: 14,
    x: 3068.0,
    y: 31.0,
    z: 3176.0,
    world_id: 'WI_WORLD_MADRIGAL',
    zone_id: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as unknown as CharacterRow;
}

describe('PlayerListSerializer', () => {
  const serializer = new PlayerListSerializer();

  describe('build()', () => {
    it('writes PLAYER_LIST opcode as leading DWORD', () => {
      const buf = serializer.build(0xAABBCCDD, []);
      const reader = new PacketReader(buf);
      assert.equal(reader.readDword(), PACKETTYPE.PLAYER_LIST);
    });

    it('echoes dwAuthKey after the opcode', () => {
      const buf = serializer.build(0x12345678, []);
      const reader = new PacketReader(buf);
      reader.readDword(); // opcode
      assert.equal(reader.readDword(), 0x12345678);
    });

    it('writes count=0 and messengerCount=0 trailer for empty list', () => {
      const buf = serializer.build(1, []);
      const reader = new PacketReader(buf);
      reader.readDword(); // opcode
      reader.readDword(); // authKey
      assert.equal(reader.readDword(), 0); // countPlayer
      assert.equal(reader.readDword(), 0); // countMessenger trailer
    });

    it('serializes one character with the canonical field order', () => {
      const buf = serializer.build(7, [makeChar()]);
      const reader = new PacketReader(buf);
      reader.readDword(); // opcode
      reader.readDword(); // authKey
      assert.equal(reader.readDword(), 1); // count

      // Per-char struct (DbManager.cpp:643-700):
      assert.equal(reader.readDword(), 0);   // slot (int, 4 bytes)
      assert.equal(reader.readDword(), 0);   // block
      assert.equal(reader.readDword(), 1);   // worldID (WI_WORLD_MADRIGAL)
      assert.equal(reader.readDword(), 11);  // m_dwIndex (MI_MALE)
      assert.equal(reader.readString(), 'Hero'); // m_szName
      assert.equal(reader.readFloat(), 3068.0); // pos.x
      assert.equal(reader.readFloat(), 31.0);   // pos.y
      assert.equal(reader.readFloat(), 3176.0); // pos.z
      assert.equal(reader.readDword(), 1);   // m_idPlayer
      assert.equal(reader.readDword(), 0);   // idparty
      assert.equal(reader.readDword(), 0);   // idGuild
      assert.equal(reader.readDword(), 0);   // idWar
      assert.equal(reader.readDword(), 4);   // skinSet <- skin_color
      assert.equal(reader.readDword(), 1);   // hairMesh <- hair_style
      assert.equal(reader.readDword(), 2);   // hairColor <- hair_color
      assert.equal(reader.readDword(), 3);   // headMesh <- face_style
      assert.equal(reader.readByte(), 0);    // sex <- gender (BYTE)
      assert.equal(reader.readDword(), 0);   // job <- class
      assert.equal(reader.readDword(), 15);  // level
      assert.equal(reader.readDword(), 0);   // jobLv placeholder
      assert.equal(reader.readDword(), 20);  // str
      assert.equal(reader.readDword(), 18);  // sta
      assert.equal(reader.readDword(), 16);  // dex
      assert.equal(reader.readDword(), 14);  // int
      assert.equal(reader.readDword(), 0);   // m_dwMode
      assert.equal(reader.readDword(), 0);   // equipCount

      assert.equal(reader.readDword(), 0);   // countMessenger trailer
    });

    it('uses MI_FEMALE (12) for gender=1', () => {
      const buf = serializer.build(1, [makeChar({ gender: 1, name: 'Heroine' })]);
      const reader = new PacketReader(buf);
      reader.readDword(); // opcode
      reader.readDword(); // authKey
      reader.readDword(); // count
      reader.readDword(); // slot
      reader.readDword(); // block
      reader.readDword(); // worldID
      assert.equal(reader.readDword(), 12); // MI_FEMALE
    });

    it('serializes multiple characters', () => {
      const buf = serializer.build(1, [
        makeChar({ id: 100, name: 'A', slot: 0 }),
        makeChar({ id: 200, name: 'B', slot: 1, gender: 1 }),
      ]);
      const reader = new PacketReader(buf);
      reader.readDword(); // opcode
      reader.readDword(); // authKey
      assert.equal(reader.readDword(), 2); // count
    });
  });
});
