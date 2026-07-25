/**
 * Mirror of the v19 C++ LOAD side of CMover::Serialize + CItemContainer.
 * Walks the TS-built JOIN payload and reports the consumed offset at each
 * stage so we can pinpoint any byte drift vs the client's read.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { PlayerSnapshotSerializer } from '../src/net/snapshot/playerSnapshot.serializer';

const MAX_HUMAN_PARTS = 31;
const MAX_JOB = 32;
const MAX_SKILL_JOB = 45;
const SM_MAX = 26;
const MAX_HONOR_TITLE = 150;
const MAX_INVENTORY = 42;
const INVENTORY_SLOTS = 73;
const BANK_SLOTS = 42;
const MAX_BANK_TABS = 3;

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'Hero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0x112233, face_style: 3, skin_color: 1,
    level: 1, exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 1.5, y: 2.5, z: 3.5, world_id: 'MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

class R {
  o = 0;
  constructor(public b: Buffer) {}
  u8()  { const v = this.b.readUInt8(this.o); this.o += 1; return v; }
  i8()  { const v = this.b.readInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  bytes(n: number) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  string() { const len = this.u32(); return this.bytes(len).toString('utf8'); }
}

describe('JOIN payload -- client-side read walk', () => {
  it('consumes exactly the bytes TS wrote (no drift)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    // Populate inventory + equip + bank like a real played character would.
    p.m_Inventory[0] = { itemId: 2104, count: 50 };            // stack in bag
    p.m_Inventory[5] = { itemId: 2811, count: 1, refine: 5, durability: 100 }; // equipped-ish
    p.m_Inventory[MAX_INVENTORY + 0] = { itemId: 2000, count: 1, refine: 3, durability: 50 }; // PARTS_HAND
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 2001, count: 1, refine: 0, durability: 50 }; // PARTS_HEAD
    (p as any).m_Bank = p.m_Bank ?? [[],[],[]];
    p.m_Bank[0]![0] = { itemId: 2104, count: 999 };
    p.m_Bank[1]![3] = { itemId: 2820, count: 1, refine: 8, durability: 100 };
    const buf = new PlayerSnapshotSerializer().build(p);
    const r = new R(buf);
    const log: string[] = [];
    const mark = (label: string) => log.push(`${label} @${r.o}`);

    // Packet header (opcode is in buffer; OnJoin dispatcher consumes it but
    // OnSnapshot starts at objidPlayer -- we walk from the opcode for accounting)
    r.u32();                       // JOIN opcode
    r.u32();                       // objidPlayer
    let cb = r.u16();            // cb
    mark(`header cb=${cb}`);

    while (cb-- > 0) {
      r.u32();                     // objid
      const hdr = r.u16();         // hdr
      mark(`entry hdr=0x${hdr.toString(16)} @${r.o}`);
      if (hdr === 0x9910) {        // WORLD_READINFO
        r.u32(); r.f32(); r.f32(); r.f32();
        mark('worldreadinfo done');
        continue;
      }
      if (hdr !== 0x00f0) continue; // ADD_OBJ
      // ADD_OBJ prefix
      r.u8();                      // dwObjType
      r.u32();                     // dwObjIndex
      // CObj::Serialize
      r.u8();                      // m_dwType
      r.u32();                     // m_dwIndex
      r.u16();                     // scale
      r.f32(); r.f32(); r.f32();   // pos
      r.i16();                     // angle
      mark(`after CObj`);
      // CCtrl::Serialize
      r.u32();                     // m_objid
      mark(`after CCtrl m_objid`);

      // CMover::Serialize
      r.u16();                     // m_dwMotion
      const bPlayer = r.u8();      // m_bPlayer
      r.i32();                     // m_nHitPoint
      r.u32();                     // GetState
      r.u32();                     // GetStateFlag
      r.u8();                      // m_dwBelligerence
      r.u32();                     // m_dwMoverSfxId (__VER>=15)
      mark(`mover prefix bPlayer=${bPlayer}`);
      if (!bPlayer) throw new Error('expected player');

      r.string();                  // m_szName
      r.u8();                      // sex
      r.u8(); r.u8();              // skinSet, hairMesh
      r.u32();                     // hairColor
      r.u8();                      // headMesh
      r.u32();                     // idPlayer
      r.u8();                      // job
      r.u16(); r.u16(); r.u16(); r.u16(); r.u16(); // str/sta/dex/int/level
      r.i32();                     // fuel
      r.u32();                     // tmAccFuel (time_t)
      r.u8();                      // guild flag
      r.u32();                     // idGuildCloak
      r.u8();                      // party flag
      r.i8();                      // m_dwAuthorization (char)
      r.u32();                     // m_dwMode
      r.u32();                     // m_dwStateMode
      r.u32();                     // dwUseItemId
      r.u32();                     // m_dwPKTime
      r.i32();                     // m_nPKValue
      r.u32();                     // m_dwPKPropensity
      r.u32();                     // m_dwPKExp
      r.i32();                     // m_nFame
      r.u8();                      // m_nDuel
      r.i32();                     // m_nHonor
      for (let i = 0; i < MAX_HUMAN_PARTS; i++) r.i32(); // equipInfo nOption
      r.i32();                     // m_nGuildCombatState
      for (let j = 0; j < SM_MAX; j++) r.u32();           // m_dwSMTime
      mark(`prefix+stats done`);

      // METHOD_NONE branch
      r.u16();                     // m_nManaPoint
      r.u16();                     // m_nFatiguePoint
      r.i32();                     // m_nTutorialState
      r.i32();                     // m_nFxp
      r.u32();                     // dwGold
      r.u64();                     // m_nExp1
      r.i32();                     // m_nSkillLevel
      r.i32();                     // m_nSkillPoint
      r.u64();                     // m_nDeathExp
      r.i32();                     // m_nDeathLevel
      for (let i = 0; i < MAX_JOB; i++) r.u32();          // dwJobLv
      r.u32();                     // m_idMarkingWorld
      r.f32(); r.f32(); r.f32();   // m_vMarkingPos
      const nQuest = r.u8();
      r.bytes(nQuest * 12);
      const nCQ = r.u8();
      r.bytes(nCQ * 2);
      const nChQ = r.u8();
      r.bytes(nChQ * 2);
      r.u32();                     // m_idMurderer
      r.i16();                     // m_nRemainGP
      r.i16();                     // padding
      for (let i = 0; i < MAX_HUMAN_PARTS; i++) r.u32();   // equipInfo dwId
      r.bytes(MAX_SKILL_JOB * 8);  // m_aJobSkill
      r.u8();                      // m_nCheerPoint
      r.u32();                     // m_dwTickCheer
      r.u8();                      // m_nSlot
      for (let k = 0; k < 3; k++) r.u32();                 // m_dwGoldBank
      for (let k = 0; k < 3; k++) r.u32();                 // m_idPlayerBank
      r.i32();                     // m_nPlusMaxHitPoint
      r.u8(); r.u8(); r.u8();      // resist L/R/def
      r.u64();                     // m_nAngelExp
      r.i32();                     // m_nAngelLevel
      mark(`METHOD_NONE pre-containers done`);

      // m_Inventory
      readContainer(r, INVENTORY_SLOTS, 'inv');
      // m_Bank * 3
      for (let k = 0; k < MAX_BANK_TABS; k++) readContainer(r, BANK_SLOTS, `bank${k}`);
      mark(`after all containers`);
      r.u32();                     // GetPetId
      r.bytes(3);                  // Pocket (3 flag bytes)
      r.u32();                     // m_dwMute
      for (let i = 0; i < MAX_HONOR_TITLE; i++) r.u32();   // m_aHonorTitle
      r.u32();                     // m_idCampus
      r.i32();                     // m_nCampusPoint
      mark(`after campus (pre-buffs)`);
      // buffs: count(4) + 0
      r.u32();
      mark(`after buffs`);
    }
    mark('end');
    console.log(log.join('\n'));
    assert.equal(r.o, buf.length, `read walk ended at ${r.o}, buffer is ${buf.length}`);
  });
});

function readContainer(r: R, slots: number, label: string): void {
  r.bytes(slots * 4);             // m_apIndex
  const chSize = r.u8();
  for (let i = 0; i < chSize; i++) {
    r.u8();                       // slot index
    readCItemElem(r);
  }
  r.bytes(slots * 4);             // adwObjIndex
}

function readCItemElem(r: R): void {
  // CItemBase
  r.u32(); r.u32();               // m_dwObjId, m_dwItemId
  r.u32();                        // m_liSerialNumber
  r.u32();                        // m_szItemText length (empty)
  // CItemElem
  r.i16();                        // m_nItemNum
  r.u8();                         // m_nRepairNumber
  r.i32();                        // m_nHitPoint
  r.i32();                        // m_nRepair
  r.u8();                         // m_byFlag
  r.i32();                        // m_nAbilityOption
  r.u32();                        // m_idGuild
  r.u8();                         // m_bItemResist
  r.i32();                        // m_nResistAbilityOption
  r.i32();                        // m_nResistSMItemId
  // piercing (3 sizes)
  r.u32(); r.u32(); r.u32();
  r.u32();                        // m_bCharged (BOOL=int 4B)
  r.u64();                        // m_iRandomOptItemId (__int64)
  r.u32();                        // m_dwKeepTime (0 -> skip time_t)
  r.u8();                         // bPet (0 -> skip CPet)
  r.u32();                        // m_bTranformVisPet (BOOL=int 4B)
}
