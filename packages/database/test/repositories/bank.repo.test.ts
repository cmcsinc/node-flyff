/**
 * BankRepository test -- account-shared bank CRUD + container gold/pin.
 *
 * Runs the full migration chain (001..008): 008 renames `bank`->`bank_item` and
 * creates the `bank` container that holds gold + bank_pass. Bank item rows are
 * keyed by `(account_id, tab, slot)`; the per-account unique over `(tab, slot)`
 * means upserts merge in place.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { BankRepository } from '../../src/repositories/bank.repo';
import { applyAllMigrations } from '../migrateAll';

const knex = (knexModule as any).default || knexModule;

describe('bank.repo.ts', () => {
  let db: Knex;
  let repo: BankRepository;
  let accountId: number;

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await applyAllMigrations(db);
    repo = new BankRepository(db);

    const [row] = await db('accounts').insert({ username: 'bankacc', password_hash: 'h' }).returning('id');
    accountId = row.id;
  });

  after(async () => {
    await db.destroy();
  });

  it('setItem inserts then upserts on (account_id, tab, slot)', async () => {
    await repo.setItem(accountId, 0, 5, 2950, 10);
    await repo.setItem(accountId, 0, 5, 2950, 25); // same key -> merge
    const item = await repo.getItem(accountId, 0, 5);
    assert.ok(item);
    assert.equal(item!.item_id, 2950);
    assert.equal(item!.quantity, 25, 'upsert merged quantity');
  });

  it('getItem returns null for an empty slot', async () => {
    const item = await repo.getItem(accountId, 1, 40);
    assert.equal(item, null);
  });

  it('keeps tabs independent (same slot, different tab)', async () => {
    await repo.setItem(accountId, 0, 0, 1000, 1);
    await repo.setItem(accountId, 2, 0, 2000, 1);
    const a = await repo.getItem(accountId, 0, 0);
    const b = await repo.getItem(accountId, 2, 0);
    assert.equal(a!.item_id, 1000);
    assert.equal(b!.item_id, 2000);
  });

  it('findByAccountId returns rows across all tabs ordered by tab then slot', async () => {
    const rows = await repo.findByAccountId(accountId);
    assert.ok(rows.length >= 2);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      assert.ok(prev.tab < cur.tab || (prev.tab === cur.tab && prev.slot <= cur.slot), 'tab,slot ordered');
    }
  });

  it('removeItem clears the slot', async () => {
    await repo.setItem(accountId, 0, 9, 7000, 1);
    await repo.removeItem(accountId, 0, 9);
    assert.equal(await repo.getItem(accountId, 0, 9), null);
  });

  it('updateQuantity changes only the quantity', async () => {
    await repo.setItem(accountId, 1, 3, 8000, 5);
    await repo.updateQuantity(accountId, 1, 3, 99);
    const item = await repo.getItem(accountId, 1, 3);
    assert.equal(item!.quantity, 99);
    assert.equal(item!.item_id, 8000, 'itemId untouched');
  });

  it('getGold/setGold read + write the account-wide bank penya', async () => {
    assert.equal(await repo.getGold(accountId), 0, 'default 0');
    await repo.setGold(accountId, 12345);
    assert.equal(await repo.getGold(accountId), 12345);
  });

  it('getBankPass/setBankPass default to 0000 and round-trip a new pin', async () => {
    const [acc] = await db('accounts').insert({ username: 'pinacc', password_hash: 'h' }).returning('id');
    assert.equal(await repo.getBankPass(acc.id), '0000', 'no row -> 0000');
    await repo.setBankPass(acc.id, '4242');
    assert.equal(await repo.getBankPass(acc.id), '4242');
    await repo.setBankPass(acc.id, '0000');
    assert.equal(await repo.getBankPass(acc.id), '0000', 'upsert overwrites');
  });
});
