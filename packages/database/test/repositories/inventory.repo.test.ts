import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types.js';
import { InventoryRepository } from '../../src/repositories/inventory.repo.js';
import { up, down } from '../../src/migrations/001_initial.js';

const knex = (knexModule as any).default || knexModule;

describe('inventory.repo.ts', () => {
  let db: Knex;
  let repo: InventoryRepository;
  let testCharacterId: number;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    await up(db);
    repo = new InventoryRepository(db);

    // Create test account and character
    const [accountRow] = await db('accounts').insert({
      username: 'testaccount',
      password_hash: 'hash',
    }).returning('id');

    const [charRow] = await db('characters').insert({
      account_id: accountRow.id,
      name: 'TestChar',
      slot: 0,
      class: 0,
      gender: 0,
      hair_style: 1,
      hair_color: 1,
      face_style: 1,
      skin_color: 1,
      level: 1,
      exp: 0,
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
    }).returning('id');

    testCharacterId = charRow.id;
  });

  after(async () => {
    await down(db);
    await db.destroy();
  });

  describe('findByCharacterId()', () => {
    it('should return empty array for character with no items', async () => {
      const [newAccountRow] = await db('accounts').insert({
        username: 'emptyaccount',
        password_hash: 'hash',
      }).returning('id');

      const [newCharRow] = await db('characters').insert({
        account_id: newAccountRow.id,
        name: 'EmptyChar',
        slot: 0,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: 0,
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
      }).returning('id');

      const items = await repo.findByCharacterId(newCharRow.id);
      assert.equal(items.length, 0);
    });

    it('should return all items ordered by slot', async () => {
      await repo.setItem(testCharacterId, 5, 1001, 10);
      await repo.setItem(testCharacterId, 2, 1002, 5);
      await repo.setItem(testCharacterId, 8, 1003, 1);

      const items = await repo.findByCharacterId(testCharacterId);
      assert.ok(items.length >= 3);
      if (items[0]) {
        assert.equal(items[0].slot, 2);
      }
      if (items[1]) {
        assert.equal(items[1].slot, 5);
      }
      if (items[2]) {
        assert.equal(items[2].slot, 8);
      }
    });
  });

  describe('getItem()', () => {
    it('should return null for empty slot', async () => {
      const item = await repo.getItem(testCharacterId, 99);
      assert.equal(item, null);
    });

    it('should return item for occupied slot', async () => {
      await repo.setItem(testCharacterId, 10, 2001, 50);

      const item = await repo.getItem(testCharacterId, 10);
      assert.ok(item);
      assert.equal(item.item_id, 2001);
      assert.equal(item.quantity, 50);
    });
  });

  describe('setItem()', () => {
    it('should insert new item in empty slot', async () => {
      await repo.setItem(testCharacterId, 20, 3001, 100);

      const item = await repo.getItem(testCharacterId, 20);
      assert.ok(item);
      assert.equal(item.item_id, 3001);
      assert.equal(item.quantity, 100);
    });

    it('should update existing item in slot', async () => {
      await repo.setItem(testCharacterId, 21, 3002, 10);
      await repo.setItem(testCharacterId, 21, 3003, 20);

      const item = await repo.getItem(testCharacterId, 21);
      assert.ok(item);
      assert.equal(item.item_id, 3003);
      assert.equal(item.quantity, 20);
    });

    it('should set item with all fields', async () => {
      await repo.setItem(
        testCharacterId,
        22,
        4001,
        5,
        0x1234, // flags
        100, // durability
        10, // refine
        '{"str": 5}' // stats
      );

      const item = await repo.getItem(testCharacterId, 22);
      assert.ok(item);
      assert.equal(item.flags, 0x1234);
      assert.equal(item.durability, 100);
      assert.equal(item.refine, 10);
      assert.equal(item.stats, '{"str": 5}');
    });
  });

  describe('removeItem()', () => {
    it('should remove item from slot', async () => {
      await repo.setItem(testCharacterId, 30, 5001, 1);
      await repo.removeItem(testCharacterId, 30);

      const item = await repo.getItem(testCharacterId, 30);
      assert.equal(item, null);
    });

    it('should not error when removing from empty slot', async () => {
      await assert.doesNotReject(async () => {
        await repo.removeItem(testCharacterId, 999);
      });
    });
  });

  describe('clearInventory()', () => {
    it('should remove all items for character', async () => {
      await repo.setItem(testCharacterId, 40, 6001, 1);
      await repo.setItem(testCharacterId, 41, 6002, 2);
      await repo.setItem(testCharacterId, 42, 6003, 3);

      await repo.clearInventory(testCharacterId);

      const items = await repo.findByCharacterId(testCharacterId);
      assert.equal(items.length, 0);
    });
  });

  describe('updateQuantity()', () => {
    it('should update item quantity', async () => {
      await repo.setItem(testCharacterId, 50, 7001, 10);
      await repo.updateQuantity(testCharacterId, 50, 25);

      const item = await repo.getItem(testCharacterId, 50);
      assert.ok(item);
      assert.equal(item.quantity, 25);
    });
  });

  describe('moveItem()', () => {
    it('should move item to empty slot', async () => {
      await repo.setItem(testCharacterId, 60, 8001, 5);
      await repo.moveItem(testCharacterId, 60, 61);

      const fromItem = await repo.getItem(testCharacterId, 60);
      const toItem = await repo.getItem(testCharacterId, 61);

      assert.equal(fromItem, null);
      assert.ok(toItem);
      assert.equal(toItem.item_id, 8001);
    });

    it('should swap items when both slots occupied', async () => {
      await repo.setItem(testCharacterId, 70, 9001, 5);
      await repo.setItem(testCharacterId, 71, 9002, 10);
      await repo.moveItem(testCharacterId, 70, 71);

      const item70 = await repo.getItem(testCharacterId, 70);
      const item71 = await repo.getItem(testCharacterId, 71);

      assert.ok(item70);
      assert.ok(item71);
      if (item70 && item71) {
        assert.equal(item70.item_id, 9002);
        assert.equal(item71.item_id, 9001);
      }
    });
  });

  describe('splitStack()', () => {
    it('should split stack into empty slot', async () => {
      await repo.setItem(testCharacterId, 80, 10001, 100);
      await repo.splitStack(testCharacterId, 80, 81, 30);

      const item80 = await repo.getItem(testCharacterId, 80);
      const item81 = await repo.getItem(testCharacterId, 81);

      assert.ok(item80);
      assert.ok(item81);
      assert.equal(item80.quantity, 70);
      assert.equal(item81.quantity, 30);
      assert.equal(item80.item_id, item81.item_id);
    });

    it('should remove source stack when split to zero', async () => {
      await repo.setItem(testCharacterId, 82, 10002, 50);
      await repo.splitStack(testCharacterId, 82, 83, 50);

      const item82 = await repo.getItem(testCharacterId, 82);
      const item83 = await repo.getItem(testCharacterId, 83);

      assert.equal(item82, null);
      assert.ok(item83);
      assert.equal(item83.quantity, 50);
    });

    it('should not split if destination occupied', async () => {
      await repo.setItem(testCharacterId, 84, 10003, 100);
      await repo.setItem(testCharacterId, 85, 10004, 1);

      await repo.splitStack(testCharacterId, 84, 85, 30);

      const item84 = await repo.getItem(testCharacterId, 84);
      const item85 = await repo.getItem(testCharacterId, 85);

      assert.ok(item84);
      assert.ok(item85);
      assert.equal(item84.quantity, 100); // Unchanged
      assert.equal(item85.item_id, 10004); // Unchanged
    });
  });

  describe('mergeStacks()', () => {
    it('should merge two stacks of same item', async () => {
      await repo.setItem(testCharacterId, 90, 11001, 50);
      await repo.setItem(testCharacterId, 91, 11001, 30);
      await repo.mergeStacks(testCharacterId, 90, 91);

      const item90 = await repo.getItem(testCharacterId, 90);
      const item91 = await repo.getItem(testCharacterId, 91);

      assert.equal(item90, null);
      assert.ok(item91);
      assert.equal(item91.quantity, 80);
    });

    it('should not merge different item types', async () => {
      await repo.setItem(testCharacterId, 92, 12001, 50);
      await repo.setItem(testCharacterId, 93, 12002, 30);

      await repo.mergeStacks(testCharacterId, 92, 93);

      const item92 = await repo.getItem(testCharacterId, 92);
      const item93 = await repo.getItem(testCharacterId, 93);

      assert.ok(item92);
      assert.ok(item93);
      assert.equal(item92.quantity, 50); // Unchanged
      assert.equal(item93.quantity, 30); // Unchanged
    });
  });

  describe('countItems()', () => {
    it('should return 0 for empty inventory', async () => {
      const [newAccountRow] = await db('accounts').insert({
        username: 'emptycountacc',
        password_hash: 'hash',
      }).returning('id');

      const [newCharRow] = await db('characters').insert({
        account_id: newAccountRow.id,
        name: 'EmptyCountChar',
        slot: 0,
        class: 0,
        gender: 0,
        hair_style: 1,
        hair_color: 1,
        face_style: 1,
        skin_color: 1,
        level: 1,
        exp: 0,
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
      }).returning('id');

      const count = await repo.countItems(newCharRow.id);
      assert.equal(count, 0);
    });

    it('should return item count', async () => {
      await repo.setItem(testCharacterId, 100, 13001, 1);
      await repo.setItem(testCharacterId, 101, 13002, 2);
      await repo.setItem(testCharacterId, 102, 13003, 3);

      const count = await repo.countItems(testCharacterId);
      assert.ok(count >= 3);
    });
  });

  describe('slotOccupied()', () => {
    it('should return false for empty slot', async () => {
      const occupied = await repo.slotOccupied(testCharacterId, 999);
      assert.equal(occupied, false);
    });

    it('should return true for occupied slot', async () => {
      await repo.setItem(testCharacterId, 110, 14001, 1);

      const occupied = await repo.slotOccupied(testCharacterId, 110);
      assert.equal(occupied, true);
    });
  });
});
