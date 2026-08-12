import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, MAX_SKILL_JOB } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42,
    account_id: 7,
    name: 'TestHero',
    slot: 0,
    class: 1,
    gender: 0,
    hair_style: 2,
    hair_color: 0x112233,
    face_style: 3,
    skin_color: 1,
    level: 15,
    exp: 0n,
    hp: 100,
    mp: 50,
    max_hp: 100,
    max_mp: 50,
    strength: 15,
    stamina: 15,
    dexterity: 15,
    intelligence: 15,
    x: 1.5,
    y: 2.5,
    z: 3.5,
    world_id: 'MADRIGAL',
    zone_id: 1,
    remain_gp: 0,
    skill_point: 0,
    skill_level: 0,
    pk_propensity: 0,
    pk_value: 0,
    pk_time: 0,
    pk_exp: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

function makeSocket() {
  const written: Buffer[] = [];
  return { write: (b: Buffer) => { written.push(b); return true; }, _written: written };
}

describe('CPlayer entity', () => {
  it('maps a CharacterRow into C++-style fields', () => {
    const sock = makeSocket();
    const p = CPlayer.fromRow(makeRow(), sock);

    assert.equal(p.m_idPlayer, 42);
    assert.equal(p.m_szName, 'TestHero');
    assert.equal(p.m_nLevel, 15);
    assert.equal(p.m_nJob, 1);
    assert.equal(p.m_nSex, 0);
    assert.equal(p.m_nGold, 0);
    assert.deepEqual(p.m_vPos, { x: 1.5, y: 2.5, z: 3.5 });
    assert.equal(p.m_nHp, 100);
    assert.equal(p.m_nMp, 50);
    assert.equal(p.m_nStr, 15);
    assert.equal(p.m_dwSkin, 1);
    assert.equal(p.m_nHairMesh, 2);
    assert.equal(p.m_dwHairColor, 0x112233);
    assert.equal(p.m_nHeadMesh, 3);
    assert.equal(p.m_worldId, 'MADRIGAL');
    assert.equal(p.m_nZoneId, 1);
    assert.equal(p.socket, sock);
  });

  it('starts with an empty _dirty set', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    assert.equal(p._dirty.size, 0);
  });

  it('defaults m_nGold to 0 until JOIN hydrates the inventory container', () => {
    // Gold is a container attribute (migration 008): the entity no longer reads
    // it from the character row. It is loaded into m_nGold by JoinService via
    // InventoryRepository.getGold after fromRow. The field defaults to 0 here.
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    assert.equal(p.m_nGold, 0);
    p.m_nGold = 4500;
    assert.equal(p.m_nGold, 4500);
  });

  it('marks dirty fields for partial flush', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nHp = 80;
    p._dirty.add('m_nHp');
    assert.ok(p._dirty.has('m_nHp'));
  });

  it('writes through the held socket reference', () => {
    const sock = makeSocket();
    const p = CPlayer.fromRow(makeRow(), sock);
    const buf = Buffer.from([1, 2, 3]);
    p.socket.write(buf);
    assert.equal(sock._written[0], buf);
  });

  it('starts with a 51-slot skill roster of NULL_ID/0', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    assert.equal(p.m_aJobSkill.length, 51);
    assert.equal(p.m_aJobSkill[0]!.skillId, 0xffffffff, 'empty slot sentinel');
    assert.equal(p.m_aJobSkill[0]!.level, 0);
    assert.equal(p.m_aJobSkill[50]!.skillId, 0xffffffff);
    assert.equal(p.m_nSkillPoint, 0, 'SP defaults to 0');
    assert.equal(p.m_nSkillLevel, 0, 'total SP defaults to 0');
    assert.equal(p.m_tmReUseDelay.length, MAX_SKILL_JOB);
    assert.equal(p.m_tmReUseDelay[0], 0, 'cooldowns start ready');
    assert.equal(p.m_cooltime.length, 4, '4 consumable cooldown groups');
    assert.equal(p.m_cooltime[0], 0, 'cooltime groups start ready');
  });

  it('hydrates m_nSkillPoint/m_nSkillLevel from the row', () => {
    const p = CPlayer.fromRow(makeRow({ skill_point: 12, skill_level: 35 } as Partial<CharacterRow>), makeSocket());
    assert.equal(p.m_nSkillPoint, 12);
    assert.equal(p.m_nSkillLevel, 35);
  });

  it('hydrateSkills writes learned slots and drops empty/invalid ones', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([
      { slot: 0, skillId: 1, level: 5 },
      { slot: 1, skillId: 2, level: 3 },
      { slot: 2, skillId: 0xffffffff, level: 0 }, // NULL_ID -> drop
      { slot: 3, skillId: 0, level: 0 },          // 0 -> drop
      { slot: 99, skillId: 100, level: 1 },       // OOB -> drop
    ]);
    assert.deepEqual(p.m_aJobSkill[0], { skillId: 1, level: 5 });
    assert.deepEqual(p.m_aJobSkill[1], { skillId: 2, level: 3 });
    assert.equal(p.m_aJobSkill[2]!.skillId, 0xffffffff, 'NULL_ID stays empty');
    assert.equal(p.m_aJobSkill[3]!.skillId, 0xffffffff, '0-id stays empty');
  });

  it('seedRoster fills slots in order at level 0, rest stay empty', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.seedRoster([1, 2, 3]);
    assert.deepEqual(p.m_aJobSkill[0], { skillId: 1, level: 0 });
    assert.deepEqual(p.m_aJobSkill[1], { skillId: 2, level: 0 });
    assert.deepEqual(p.m_aJobSkill[2], { skillId: 3, level: 0 });
    assert.equal(p.m_aJobSkill[3]!.skillId, 0xffffffff, 'slot 3 still empty');
  });

  it('overlaySkillLevels applies learned levels by skillId, drops unmatched', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.seedRoster([1, 2, 3]);
    p.overlaySkillLevels([
      { skillId: 2, level: 7 },      // matches slot 1
      { skillId: 3, level: 0 },      // level 0 -> ignored
      { skillId: 999, level: 4 },    // no matching roster slot -> dropped
    ]);
    assert.equal(p.m_aJobSkill[0]!.level, 0, 'unlearned stays 0');
    assert.equal(p.m_aJobSkill[1]!.level, 7, 'learned level applied by id');
    assert.equal(p.m_aJobSkill[2]!.level, 0, 'level-0 overlay ignored');
  });

  describe('findSlotByObjId', () => {
    it('resolves by stable objid even after the item moved to a different slot', () => {
      // Item picked up at bag slot 3 (objid=3), then moved to slot 10 by a prior
      // equip/unequip. Client still addresses it by m_dwObjId=3. A direct
      // m_Inventory[3] lookup would miss -- the scan must find it at slot 10.
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[10] = { itemId: 5000, count: 1, objid: 3 };
      assert.equal(p.findSlotByObjId(3), 10);
    });

    it('returns -1 when no item carries the objid', () => {
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[0] = { itemId: 5000, count: 1, objid: 0 };
      assert.equal(p.findSlotByObjId(99), -1);
    });

    it('falls back to treating objid as a slot for items without a tracked objid', () => {
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[5] = { itemId: 5000, count: 1 }; // no objid field
      assert.equal(p.findSlotByObjId(5), 5);
    });
  });

  describe('m_invIndex (client m_apIndex mirror)', () => {
    it('is identity for the bag range and NULL_ID for equip range at construction', () => {
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      assert.equal(p.clientObjId(0), 0);
      assert.equal(p.clientObjId(41), 41);
      // equip range (42..72) is NULL_ID until syncInvIndexAfterLoad
      assert.equal(p.m_invIndex[42], 0xffffffff);
    });

    it('syncInvIndexAfterLoad marks equipped slots identity and empty equip slots NULL_ID', () => {
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[42] = { itemId: 5000, count: 1 }; // equipped upper-body
      p.syncInvIndexAfterLoad();
      assert.equal(p.clientObjId(42), 42);   // equipped -> slot id
      assert.equal(p.m_invIndex[43], 0xffffffff); // empty equip slot -> NULL_ID
    });

    it('onUnequipIndexMove: bag dst takes the equip objid, equip src cleared (the reported bug)', () => {
      // JOIN-loaded armor at equip slot 44 -> m_apIndex[44] = 44. Unequip into
      // bag slot 5: client sets m_apIndex[5] = 44 (stale). addItem into slot 5
      // MUST reuse objid 44 or CREATEITEM writes m_apItem[5] while the grid
      // still draws m_apItem[44] -> invisible.
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[44] = { itemId: 5000, count: 1 };
      p.syncInvIndexAfterLoad();
      p.onUnequipIndexMove(44, 5);
      assert.equal(p.clientObjId(5), 44);
      assert.equal(p.m_invIndex[44], 0xffffffff);
    });

    it('onEquipIndexMove: equip dst takes bag objid, bag src takes a fresh free objid', () => {
      // Equip from bag slot 5 (objid 5) into equip slot 44. Client moves the
      // objid to 44 and assigns slot 5 a fresh empty m_apItem index.
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[5] = { itemId: 5000, count: 1 };
      p.onEquipIndexMove(5, 44);
      assert.equal(p.clientObjId(44), 5);          // equip slot holds objid 5
      const freed = p.clientObjId(5);
      assert.notEqual(freed, 5);                   // bag slot 5 got a fresh objid
      assert.ok(freed >= 0 && freed < 73, 'freed objid in range');
    });

    it('firstFreeObjId skips objids in use by occupied slots', () => {
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      p.m_Inventory[0] = { itemId: 1, count: 1 }; // objid 0 in use
      p.m_Inventory[1] = { itemId: 2, count: 1 }; // objid 1 in use
      p.onEquipIndexMove(0, 44);                  // frees slot 0, picks first free
      // objid 0 still used (now at equip 44); slot 0's fresh pick must skip 0
      assert.notEqual(p.clientObjId(0), 0);
      assert.notEqual(p.clientObjId(0), 1);
    });

    it('onInvSlotsSwapped: swaps the m_apIndex entries of two slots (MOVEITEM)', () => {
      const p = CPlayer.fromRow(makeRow(), makeSocket());
      const before2 = p.clientObjId(2);
      const before5 = p.clientObjId(5);
      p.onInvSlotsSwapped(2, 5);
      assert.equal(p.clientObjId(2), before5);
      assert.equal(p.clientObjId(5), before2);
    });
  });
});
