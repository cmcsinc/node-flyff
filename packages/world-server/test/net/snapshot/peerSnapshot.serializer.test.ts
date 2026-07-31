import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PeerSnapshotSerializer } from '../../../src/net/snapshot/peerSnapshot.serializer';
import { CPlayer } from '@flyff/entities';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  OT_MOVER, MI_MALE, MI_FEMALE, SNAPSHOTTYPE_ADD_OBJ, SNAPSHOTTYPE_DEL_OBJ,
  MAX_INVENTORY,
} from '@flyff/world-core';
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

function makePlayer(over: Partial<CharacterRow> = {}): CPlayer {
  return CPlayer.fromRow(makeRow(over), { write: () => true });
}

const NULL_ID = 0xffffffff;
/** `PARTS_UPPER_BODY` -- the chest slot (`_Common/Item.h:548`). */
const PARTS_UPPER_BODY = 2;
const serializer = new PeerSnapshotSerializer();

/** Byte offset of the first entry: the 10-byte SNAPSHOT head. */
const ENTRY_AT = 10;
/** Fixed body tail: [dwPetId:DWORD][petName:String ""][CBuffMgr count:DWORD]. */
const TAIL_LEN = 12;
/** One equip entry: [uParts:BYTE][m_dwItemId:WORD][m_byFlag:BYTE]. */
const EQUIP_ENTRY_LEN = 4;

describe('PeerSnapshotSerializer', () => {
  describe('build (ADD_OBJ)', () => {
    const player = makePlayer();
    const buf = serializer.build([player]);

    it('frames SNAPSHOT + unused objidPlayer + entry count', () => {
      assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
      assert.equal(buf.readUInt32LE(4), NULL_ID);  // objidPlayer -- unused client-side
      assert.equal(buf.readUInt16LE(8), 1);        // cb
    });

    it('writes the ADD_OBJ prefix with the gender model index', () => {
      assert.equal(buf.readUInt32LE(ENTRY_AT), 42);                    // objid
      assert.equal(buf.readUInt16LE(ENTRY_AT + 4), SNAPSHOTTYPE_ADD_OBJ);
      assert.equal(buf.readUInt8(ENTRY_AT + 6), OT_MOVER);             // dwObjType
      assert.equal(buf.readUInt32LE(ENTRY_AT + 7), MI_MALE);           // dwObjIndex
    });

    it('writes the CObj duplicate type/index, scale, pos and angle', () => {
      assert.equal(buf.readUInt8(ENTRY_AT + 11), OT_MOVER);            // m_dwType dup
      assert.equal(buf.readUInt32LE(ENTRY_AT + 12), MI_MALE);          // m_dwIndex dup
      assert.equal(buf.readUInt16LE(ENTRY_AT + 16), 100);              // scale 1.0
      assert.equal(buf.readFloatLE(ENTRY_AT + 18), 1.5);
      assert.equal(buf.readFloatLE(ENTRY_AT + 22), 2.5);
      assert.equal(buf.readFloatLE(ENTRY_AT + 26), 3.5);
      assert.equal(buf.readUInt16LE(ENTRY_AT + 30), 0);                // m_fAngle * 10
      assert.equal(buf.readUInt32LE(ENTRY_AT + 32), 42);               // CCtrl m_objid
    });

    it('marks the mover as a player so the client takes the PLAYER branch', () => {
      // CMover prefix: [m_dwMotion:WORD][m_bPlayer:BYTE]
      assert.equal(buf.readUInt16LE(ENTRY_AT + 36), 0);                // m_dwMotion
      assert.equal(buf.readUInt8(ENTRY_AT + 38), 1);                   // m_bPlayer
    });

    it('writes BELLI_PEACEFUL so alt+click opens the player menu', () => {
      // [m_dwMotion:WORD][m_bPlayer:BYTE][m_nHitPoint:DWORD][GetState:DWORD]
      // [GetStateFlag:DWORD][m_dwBelligerence:BYTE]. 0 here => IsPeaceful() false
      // on the peer copy => WndWorld.cpp:7248 never calls ShowMoverMenu.
      assert.equal(buf.readUInt8(ENTRY_AT + 51), 1);                   // BELLI_PEACEFUL
    });

    it('picks the female model for gender 1', () => {
      const female = serializer.build([makePlayer({ gender: 1 })]);
      assert.equal(female.readUInt32LE(ENTRY_AT + 7), MI_FEMALE);
    });

    it('scales m_fAngle by 10 like CObj::Serialize', () => {
      const p = makePlayer();
      p.m_fAngle = 12.3;
      const framed = serializer.build([p]);
      assert.equal(framed.readUInt16LE(ENTRY_AT + 30), 123);
    });

    it('batches every player into one packet', () => {
      const many = serializer.build([makePlayer({ id: 1 }), makePlayer({ id: 2 })]);
      assert.equal(many.readUInt16LE(8), 2);
      assert.equal(many.readUInt32LE(ENTRY_AT), 1);
    });

    it('is shorter than the self frame -- no inventory/bank/quest state', () => {
      // The whole point of METHOD_EXCLUDE_ITEM: peers get appearance + equip only.
      // The self JOIN frame carries 73 inventory + 3*42 bank slots (~2 KB).
      assert.ok(buf.length < 500, `expected a short peer frame, got ${buf.length} bytes`);
    });

    it('writes the equip list, pet id and buff count at the frame tail', () => {
      const p = makePlayer();
      p.m_Inventory[MAX_INVENTORY + PARTS_UPPER_BODY] =
        { itemId: 1234, count: 1, flags: 7 };
      const framed = serializer.build([p]);
      // Anchor on the tail: the EXCLUDE_ITEM body ends with a fixed 12 bytes
      // (petId + empty pet name + buff count), preceded by the 4-byte equip
      // entry and the uSize byte. The CMover prefix ahead of it is
      // variable-length (m_szName), so a tail offset is the stable anchor.
      let at = framed.length - TAIL_LEN - EQUIP_ENTRY_LEN - 1;
      assert.equal(framed.readUInt8(at), 1); at += 1;                  // uSize
      assert.equal(framed.readUInt8(at), PARTS_UPPER_BODY); at += 1;   // uParts
      assert.equal(framed.readUInt16LE(at), 1234); at += 2;            // m_dwItemId
      assert.equal(framed.readUInt8(at), 7); at += 1;                  // m_byFlag
      assert.equal(framed.readUInt32LE(at), NULL_ID); at += 4;         // dwPetId (no pet)
      assert.equal(framed.readUInt32LE(at), 0); at += 4;               // pet name (empty)
      assert.equal(framed.readUInt32LE(at), 0);                        // CBuffMgr count
    });

    it('writes uSize=0 for a player with nothing equipped', () => {
      assert.equal(buf.readUInt8(buf.length - TAIL_LEN - 1), 0); // uSize
    });

    it('opens the body with an empty private-shop title', () => {
      // A vending player's sign; empty (DWORD length 0) until player vending
      // ships. It sits immediately before uSize.
      assert.equal(buf.readUInt32LE(buf.length - TAIL_LEN - 5), 0);
    });
  });

  describe('buildRemove (DEL_OBJ)', () => {
    it('writes one bodyless objid|DEL_OBJ pair per id', () => {
      const buf = serializer.buildRemove([7, 9]);
      assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
      assert.equal(buf.readUInt32LE(4), NULL_ID);
      assert.equal(buf.readUInt16LE(8), 2);            // cb
      assert.equal(buf.readUInt32LE(10), 7);
      assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE_DEL_OBJ);
      assert.equal(buf.readUInt32LE(16), 9);
      assert.equal(buf.readUInt16LE(20), SNAPSHOTTYPE_DEL_OBJ);
      assert.equal(buf.length, 22);                    // no body at all
    });
  });
});
