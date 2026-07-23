import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { CharacterRepository } from '../../src/repositories/character.repo';
import { up, down } from '../../src/migrations/001_initial';
import { up as upGold } from '../../src/migrations/003_character_gold';
import { up as upBankPass } from '../../src/migrations/006_bank_pass';

const knex = (knexModule as any).default || knexModule;

describe('character.repo.ts', () => {
  let db: Knex;
  let repo: CharacterRepository;
  let testAccountId: number;
  // Unique slot/name per character -- better-sqlite3 enforces the
  // (account_id, slot) and name UNIQUE constraints strictly.
  let _seq = 0;
  const nextSlot = (): number => ++_seq;
  const nextName = (base: string): string => `${base}${++_seq}`;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    await up(db);
    await upGold(db);
    await upBankPass(db);
    repo = new CharacterRepository(db);

    // Create test account
    const [accountRow] = await db('accounts').insert({
      username: 'testaccount',
      password_hash: 'hash',
    }).returning('id');
    testAccountId = accountRow.id;
  });

  after(async () => {
    await down(db);
    await db.destroy();
  });

  describe('findById()', () => {
    it('should return null for non-existent character', async () => {
      const character = await repo.findById(99999);
      assert.equal(character, null);
    });

    it('should return character row for existing character', async () => {
      const slot = nextSlot();
      const charId = await repo.create({
        account_id: testAccountId,
        name: nextName('TestChar'),
        slot,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      const character = await repo.findById(charId);
      assert.ok(character);
      assert.equal(character.slot, slot);
      assert.equal(character.level, 1);
    });
  });

  describe('findByAccountId()', () => {
    it('should return empty array for account with no characters', async () => {
      const [newAccountRow] = await db('accounts').insert({
        username: 'emptyaccount',
        password_hash: 'hash',
      }).returning('id');

      const characters = await repo.findByAccountId(newAccountRow.id);
      assert.equal(characters.length, 0);
    });

    it('should return all characters for account ordered by slot', async () => {
      const lowSlot = nextSlot();
      const highSlot = nextSlot();
      await repo.create({
        account_id: testAccountId,
        name: nextName('CharHi'),
        slot: highSlot,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 5,
        exp: BigInt(1000),
        hp: 200,
        mp: 100,
        max_hp: 200,
        max_mp: 100,
        strength: 20,
        stamina: 20,
        dexterity: 20,
        intelligence: 20,
        x: 100,
        y: 0,
        z: 200,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.create({
        account_id: testAccountId,
        name: nextName('CharLo'),
        slot: lowSlot,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      const characters = await repo.findByAccountId(testAccountId);
      assert.ok(characters.length >= 2);
      // Characters must be ordered by slot ascending
      const onlyMine = characters.filter((c) => c.name.startsWith('Char'));
      assert.ok(onlyMine.length >= 2);
      assert.ok(onlyMine[0]!.slot < onlyMine[1]!.slot, 'slots must be ordered');
    });
  });

  describe('findByAccountAndSlot()', () => {
    it('should return null for empty slot', async () => {
      const character = await repo.findByAccountAndSlot(testAccountId, 99988);
      assert.equal(character, null);
    });

    it('should return character for occupied slot', async () => {
      const slot = nextSlot();
      const charId = await repo.create({
        account_id: testAccountId,
        name: nextName('SlotChar'),
        slot,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      const character = await repo.findByAccountAndSlot(testAccountId, slot);
      assert.ok(character);
      assert.equal(character.id, charId);
      assert.equal(character.slot, slot);
    });
  });

  describe('create()', () => {
    it('should create character and return ID', async () => {
      const name = nextName('NewChar');
      const id = await repo.create({
        account_id: testAccountId,
        name,
        slot: nextSlot(),
        class: 1,
        gender: 1,
        hair_style: 2,
        hair_color: 3,
        face_style: 1,
        skin_color: 2,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      assert.equal(typeof id, 'number');
      assert.ok(id > 0);

      const character = await repo.findById(id);
      assert.ok(character);
      assert.equal(character.name, name);
      assert.equal(character.gender, 1);
    });
  });

  describe('update()', () => {
    it('should update character name', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: nextName('OldName'),
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.update(charId, { name: 'NewName' });

      const character = await repo.findById(charId);
      assert.ok(character);
      assert.equal(character.name, 'NewName');
    });
  });

  describe('updatePosition()', () => {
    it('should update character position', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: nextName('Mover'),
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.updatePosition(charId, 100.5, 200.3, 300.1);

      const character = await repo.findById(charId);
      assert.ok(character);
      assert.equal(character.x, 100.5);
      assert.equal(character.y, 200.3);
      assert.equal(character.z, 300.1);
    });
  });

  describe('updateLevelAndExp()', () => {
    it('should update level and experience', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: 'Leveler',
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.updateLevelAndExp(charId, 15, BigInt(50000));

      const character = await repo.findById(charId);
      assert.ok(character);
      assert.equal(character.level, 15);
      assert.equal(character.exp, '50000');
    });
  });

  describe('updateStats()', () => {
    it('should update HP and MP', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: 'StatChar',
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.updateStats(charId, {
        hp: 50,
        mp: 25,
        max_hp: 150,
        max_mp: 75,
      });

      const character = await repo.findById(charId);
      assert.ok(character);
      assert.equal(character.hp, 50);
      assert.equal(character.mp, 25);
      assert.equal(character.max_hp, 150);
      assert.equal(character.max_mp, 75);
    });

    it('should update attributes', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: 'AttrChar',
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.updateStats(charId, {
        strength: 20,
        stamina: 18,
        dexterity: 16,
        intelligence: 14,
      });

      const character = await repo.findById(charId);
      assert.ok(character);
      assert.equal(character.strength, 20);
      assert.equal(character.stamina, 18);
      assert.equal(character.dexterity, 16);
      assert.equal(character.intelligence, 14);
    });
  });

  describe('delete()', () => {
    it('should delete character', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: 'DeleteMe',
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      await repo.delete(charId);

      const character = await repo.findById(charId);
      assert.equal(character, null);
    });
  });

  describe('countByAccountId()', () => {
    it('should return 0 for account with no characters', async () => {
      const [newAccountRow] = await db('accounts').insert({
        username: 'emptycount',
        password_hash: 'hash',
      }).returning('id');

      const count = await repo.countByAccountId(newAccountRow.id);
      assert.equal(count, 0);
    });

    it('should return character count for account', async () => {
      const count = await repo.countByAccountId(testAccountId);
      assert.ok(count > 0);
    });
  });

  describe('nameExists()', () => {
    it('should return false for non-existent name', async () => {
      const exists = await repo.nameExists('NonExistentName');
      assert.equal(exists, false);
    });

    it('should return true for existing name', async () => {
      await repo.create({
        account_id: testAccountId,
        name: 'UniqueName123',
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      const exists = await repo.nameExists('UniqueName123');
      assert.equal(exists, true);
    });
  });

  describe('slotOccupied()', () => {
    it('should return false for empty slot', async () => {
      const occupied = await repo.slotOccupied(testAccountId, 5);
      assert.equal(occupied, false);
    });

    it('should return true for occupied slot', async () => {
      const slot = nextSlot();
      await repo.create({
        account_id: testAccountId,
        name: nextName('SlotChecker'),
        slot,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world1',
        zone_id: 1,
      });

      const occupied = await repo.slotOccupied(testAccountId, slot);
      assert.equal(occupied, true);
    });
  });

  describe('findByWorldAndZone()', () => {
    it('should return characters in world/zone', async () => {
      const charId = await repo.create({
        account_id: testAccountId,
        name: 'WorldZoner',
        slot: nextSlot(),
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: BigInt(0),
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: 0,
        y: 0,
        z: 0,
        world_id: 'world2',
        zone_id: 5,
      });

      const characters = await repo.findByWorldAndZone('world2', 5);
      assert.ok(characters.length > 0);
      if (characters[0]) {
        assert.equal(characters[0].world_id, 'world2');
        assert.equal(characters[0].zone_id, 5);
      }
    });
  });
});
