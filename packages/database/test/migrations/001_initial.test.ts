import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types.js';
import { up, down } from '../../src/migrations/001_initial.js';
import { runMigrations } from '../../src/migrate.js';

const knex = (knexModule as any).default || knexModule;

describe('001_initial migration', () => {
  let db: Knex;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
  });

  after(async () => {
    await db.destroy();
  });

  // Reset schema before each test so up() starts clean (better-sqlite3
  // rejects createTable on existing tables, unlike the laxer sqlite3).
  beforeEach(async () => {
    await down(db).catch(() => {});
  });

  describe('up()', () => {
    it('should create all tables', async () => {
      await up(db);

      const tables = await db['raw'](
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );

      const tableNames = tables.map((t: any) => t.name);
      assert.ok(tableNames.includes('accounts'));
      assert.ok(tableNames.includes('characters'));
      assert.ok(tableNames.includes('inventory'));
      assert.ok(tableNames.includes('bank'));
      assert.ok(tableNames.includes('skills'));
      assert.ok(tableNames.includes('quick_slots'));
      // knex_migrations tables are created by db.migrate.latest(), not by up()
    });

    it('should create accounts table with correct schema', async () => {
      await up(db);

      const columns = await db['raw']('PRAGMA table_info(accounts)');
      const columnNames = columns.map((c: any) => c.name);

      assert.ok(columnNames.includes('id'));
      assert.ok(columnNames.includes('username'));
      assert.ok(columnNames.includes('password_hash'));
      assert.ok(columnNames.includes('email'));
      assert.ok(columnNames.includes('gm'));
      assert.ok(columnNames.includes('banned'));
      assert.ok(columnNames.includes('banned_until'));
      assert.ok(columnNames.includes('created_at'));
      assert.ok(columnNames.includes('updated_at'));
    });

    it('should create characters table with correct schema', async () => {
      await up(db);

      const columns = await db['raw']('PRAGMA table_info(characters)');
      const columnNames = columns.map((c: any) => c.name);

      assert.ok(columnNames.includes('id'));
      assert.ok(columnNames.includes('account_id'));
      assert.ok(columnNames.includes('name'));
      assert.ok(columnNames.includes('slot'));
      assert.ok(columnNames.includes('class'));
      assert.ok(columnNames.includes('level'));
      assert.ok(columnNames.includes('exp'));
      assert.ok(columnNames.includes('hp'));
      assert.ok(columnNames.includes('mp'));
      assert.ok(columnNames.includes('strength'));
      assert.ok(columnNames.includes('x'));
      assert.ok(columnNames.includes('y'));
      assert.ok(columnNames.includes('z'));
      assert.ok(columnNames.includes('world_id'));
      assert.ok(columnNames.includes('zone_id'));
    });

    it('should create inventory table with foreign key', async () => {
      await up(db);

      const columns = await db['raw']('PRAGMA table_info(inventory)');
      const columnNames = columns.map((c: any) => c.name);

      assert.ok(columnNames.includes('id'));
      assert.ok(columnNames.includes('character_id'));
      assert.ok(columnNames.includes('slot'));
      assert.ok(columnNames.includes('item_id'));
      assert.ok(columnNames.includes('quantity'));
      assert.ok(columnNames.includes('flags'));
      assert.ok(columnNames.includes('durability'));
      assert.ok(columnNames.includes('refine'));
      assert.ok(columnNames.includes('stats'));
    });

    it('should enforce unique constraint on account_id + slot', async () => {
      await up(db);

      // Insert a test account
      const [accountRow] = await db('accounts').insert({
        username: 'testuser',
        password_hash: 'hash',
      }).returning('id');

      // Insert first character in slot 0
      await db('characters').insert({
        account_id: accountRow.id,
        name: 'Char1',
        slot: 0,
      });

      // Try to insert second character in slot 0 - should fail
      await assert.rejects(
        async () => {
          await db('characters').insert({
            account_id: accountRow.id,
            name: 'Char2',
            slot: 0,
          });
        },
        /UNIQUE constraint failed/
      );
    });

    it('should enforce unique constraint on character name', async () => {
      await up(db);

      // Insert a test account
      const [accountRow] = await db('accounts').insert({
        username: 'testuser',
        password_hash: 'hash',
      }).returning('id');

      // Insert first character
      await db('characters').insert({
        account_id: accountRow.id,
        name: 'UniqueName',
        slot: 0,
      });

      // Try to insert second character with same name - should fail
      await assert.rejects(
        async () => {
          await db('characters').insert({
            account_id: accountRow.id,
            name: 'UniqueName',
            slot: 1,
          });
        },
        /UNIQUE constraint failed/
      );
    });
  });

  describe('down()', () => {
    it('should drop all tables', async () => {
      await up(db);
      await down(db);

      const tables = await db['raw'](
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );

      const tableNames = tables.map((t: any) => t.name);
      assert.ok(!tableNames.includes('accounts'));
      assert.ok(!tableNames.includes('characters'));
      assert.ok(!tableNames.includes('inventory'));
      assert.ok(!tableNames.includes('bank'));
      assert.ok(!tableNames.includes('skills'));
      assert.ok(!tableNames.includes('quick_slots'));
    });
  });

  describe('cascading deletes', () => {
    it('should delete inventory when character is deleted', async () => {
      await up(db);

      const [accountRow] = await db('accounts').insert({
        username: 'testuser',
        password_hash: 'hash',
      }).returning('id');

      const [charRow] = await db('characters').insert({
        account_id: accountRow.id,
        name: 'TestChar',
        slot: 0,
      }).returning('id');

      await db('inventory').insert({
        character_id: charRow.id,
        slot: 0,
        item_id: 1,
        quantity: 10,
      });

      // Delete character
      await db('characters').where({ id: charRow.id }).del();

      // Inventory should be deleted by cascade
      const items = await db('inventory').where({ character_id: charRow.id });
      assert.equal(items.length, 0);
    });

    it('should delete characters when account is deleted', async () => {
      await up(db);

      const [accountRow] = await db('accounts').insert({
        username: 'testuser',
        password_hash: 'hash',
      }).returning('id');

      await db('characters').insert({
        account_id: accountRow.id,
        name: 'TestChar',
        slot: 0,
      });

      // Delete account
      await db('accounts').where({ id: accountRow.id }).del();

      // Characters should be deleted by cascade
      const chars = await db('characters').where({ account_id: accountRow.id });
      assert.equal(chars.length, 0);
    });
  });
});
