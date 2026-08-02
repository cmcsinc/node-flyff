import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { AccountRepository } from '../../src/repositories/account.repo';
import { up, down } from '../../src/migrations/001_initial';

const knex = (knexModule as any).default || knexModule;

// v19 AUTH_* tiers as ASCII codes. Duplicated locally rather than imported from
// @flyff/entities: @flyff/database must not depend on sibling packages (TS6059
// rootDir break) -- migration 021_account_authority.ts declares them the same way.
const AUTH_GENERAL = 0x46;
const AUTH_ADMINISTRATOR = 0x50;

describe('account.repo.ts', () => {
  let db: Knex;
  let repo: AccountRepository;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    await up(db);
    repo = new AccountRepository(db);
  });

  after(async () => {
    await down(db);
    await db.destroy();
  });

  describe('findById()', () => {
    it('should return null for non-existent account', async () => {
      const account = await repo.findById(99999);
      assert.equal(account, null);
    });

    it('should return account row for existing account', async () => {
      const accountId = await repo.create({
        username: 'testuser',
        password_hash: 'hash123',
        email: 'test@example.com',
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const account = await repo.findById(accountId);
      assert.ok(account);
      assert.equal(account.username, 'testuser');
      assert.equal(account.password_hash, 'hash123');
      assert.equal(account.email, 'test@example.com');
      assert.equal(account.banned, false);
    });
  });

  describe('findByUsername()', () => {
    it('should return null for non-existent username', async () => {
      const account = await repo.findByUsername('nonexistent');
      assert.equal(account, null);
    });

    it('should return account row for existing username', async () => {
      await repo.create({
        username: 'findme',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const account = await repo.findByUsername('findme');
      assert.ok(account);
      assert.equal(account.username, 'findme');
    });
  });

  describe('findByEmail()', () => {
    it('should return null for non-existent email', async () => {
      const account = await repo.findByEmail('nonexistent@example.com');
      assert.equal(account, null);
    });

    it('should return account row for existing email', async () => {
      await repo.create({
        username: 'emailuser',
        password_hash: 'hash',
        email: 'found@example.com',
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const account = await repo.findByEmail('found@example.com');
      assert.ok(account);
      assert.equal(account.email, 'found@example.com');
    });
  });

  describe('create()', () => {
    it('should create account and return ID', async () => {
      const id = await repo.create({
        username: 'newuser',
        password_hash: 'hashed',
        email: 'new@example.com',
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      assert.equal(typeof id, 'number');
      assert.ok(id > 0);

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.username, 'newuser');
    });

    it('should create account with null email', async () => {
      const id = await repo.create({
        username: 'noemail',
        password_hash: 'hashed',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.email, null);
    });

    it('should create GM account', async () => {
      const id = await repo.create({
        username: 'gmadmin',
        password_hash: 'hashed',
        email: 'gm@example.com',
        authority: AUTH_ADMINISTRATOR,
        banned: false,
        banned_until: null,
      });

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.authority, AUTH_ADMINISTRATOR);
    });
  });

  describe('updatePassword()', () => {
    it('should update password hash', async () => {
      const id = await repo.create({
        username: 'pwupdate',
        password_hash: 'oldhash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      await repo.updatePassword(id, 'newhash');

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.password_hash, 'newhash');
    });
  });

  describe('update()', () => {
    it('should update email', async () => {
      const id = await repo.create({
        username: 'updateme',
        password_hash: 'hash',
        email: 'old@example.com',
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      await repo.update(id, { email: 'new@example.com' });

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.email, 'new@example.com');
    });

    it('should update multiple fields', async () => {
      const id = await repo.create({
        username: 'multiupdate',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      await repo.update(id, {
        email: 'multi@example.com',
        authority: AUTH_ADMINISTRATOR,
      });

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.email, 'multi@example.com');
      assert.equal(account.authority, AUTH_ADMINISTRATOR);
    });
  });

  describe('setBanStatus()', () => {
    it('should ban account permanently', async () => {
      const id = await repo.create({
        username: 'banme',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      await repo.setBanStatus(id, true);

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.banned, true);
      assert.equal(account.banned_until, null);
    });

    it('should ban account with expiration', async () => {
      const id = await repo.create({
        username: 'tempban',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const expiresAt = new Date('2026-12-31');
      await repo.setBanStatus(id, true, expiresAt);

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.banned, true);
      assert.ok(account.banned_until);
    });

    it('should unban account', async () => {
      const id = await repo.create({
        username: 'unbanme',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: true,
        banned_until: new Date('2026-12-31'),
      });

      await repo.setBanStatus(id, false);

      const account = await repo.findById(id);
      assert.ok(account);
      assert.equal(account.banned, false);
      assert.equal(account.banned_until, null);
    });
  });

  describe('delete()', () => {
    it('should delete account', async () => {
      const id = await repo.create({
        username: 'deleteme',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      await repo.delete(id);

      const account = await repo.findById(id);
      assert.equal(account, null);
    });
  });

  describe('usernameExists()', () => {
    it('should return false for non-existent username', async () => {
      const exists = await repo.usernameExists('nonexistent');
      assert.equal(exists, false);
    });

    it('should return true for existing username', async () => {
      await repo.create({
        username: 'exists',
        password_hash: 'hash',
        email: null,
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const exists = await repo.usernameExists('exists');
      assert.equal(exists, true);
    });
  });

  describe('emailExists()', () => {
    it('should return false for non-existent email', async () => {
      const exists = await repo.emailExists('nonexistent@example.com');
      assert.equal(exists, false);
    });

    it('should return true for existing email', async () => {
      await repo.create({
        username: 'emailexists',
        password_hash: 'hash',
        email: 'exists@example.com',
        authority: AUTH_GENERAL,
        banned: false,
        banned_until: null,
      });

      const exists = await repo.emailExists('exists@example.com');
      assert.equal(exists, true);
    });
  });
});
