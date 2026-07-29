/**
 * mail.repo.ts test -- client string limits + pending-count logic.
 *
 * Over-long title/text kill the client's archive reader (`ar.cpp:109`), so
 * `create` truncates instead of trusting the caller. `countPending` drives the
 * `MODE.MAILBOX` bit, so each of the three claim states must count.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { MailRepository } from '../../src/repositories/mail.repo';
import { up as up001, down as down001 } from '../../src/migrations/001_initial';
import { up as up017 } from '../../src/migrations/017_presence_and_mail';

const knex = (knexModule as any).default || knexModule;

describe('mail.repo.ts', () => {
  let db: Knex;
  let repo: MailRepository;
  let charId: number;

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up017(db);
    repo = new MailRepository(db);

    const [account] = await db('accounts').insert({
      username: 'mailtest', password_hash: 'hash',
    }).returning('id');
    const [row] = await db('characters').insert({
      account_id: account.id, name: 'MailChar', slot: 0, class: 0, gender: 0,
      hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1,
      level: 1, exp: 0, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
      strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
      x: 0, y: 0, z: 0, world_id: 'world1', zone_id: 1,
    }).returning('id');
    charId = row.id;
  });

  after(async () => {
    await db.schema.dropTableIfExists('mail');
    await db.schema.dropTableIfExists('online_players');
    await down001(db);
    await db.destroy();
  });

  async function clearMail(): Promise<void> {
    await db('mail').del();
  }

  it('truncates an over-long title and text', async () => {
    await clearMail();
    const id = await repo.create({
      receiver_id: charId,
      title: 'T'.repeat(80),
      text: 'X'.repeat(400),
    });
    const row = await repo.findById(id);
    assert.ok(row);
    assert.equal(row!.title.length, 31);
    assert.equal(row!.text.length, 255);
  });

  it('defaults sender to system (0) and gold to the string zero', async () => {
    await clearMail();
    const id = await repo.create({ receiver_id: charId, title: 'hi' });
    const row = await repo.findById(id);
    assert.equal(row!.sender_id, 0);
    assert.equal(row!.gold, '0');
    assert.equal(row!.item_id, null);
    assert.equal(Boolean(row!.read), false);
  });

  it('normalizes a numeric gold to a string', async () => {
    await clearMail();
    const id = await repo.create({ receiver_id: charId, gold: 12345 });
    assert.equal((await repo.findById(id))!.gold, '12345');
  });

  it('findById returns null for a missing mail', async () => {
    assert.equal(await repo.findById(999_999), null);
  });

  it('listByReceiver is oldest first', async () => {
    await clearMail();
    const a = await repo.create({ receiver_id: charId, title: 'first' });
    const b = await repo.create({ receiver_id: charId, title: 'second' });
    const rows = await repo.listByReceiver(charId);
    assert.deepEqual(rows.map((r) => r.id), [a, b]);
  });

  it('counts an unread plain mail, then stops once read', async () => {
    await clearMail();
    const id = await repo.create({ receiver_id: charId, title: 'plain' });
    assert.equal(await repo.countPending(charId), 1);
    await repo.markRead(id);
    assert.equal(await repo.countPending(charId), 0);
  });

  it('keeps counting a read mail while its item is unclaimed', async () => {
    await clearMail();
    const id = await repo.create({ receiver_id: charId, item_id: 1000, item_count: 1 });
    await repo.markRead(id);
    assert.equal(await repo.countPending(charId), 1);
    await repo.markTakenItem(id);
    assert.equal(await repo.countPending(charId), 0);
  });

  it('keeps counting a read mail while its gold is unclaimed', async () => {
    await clearMail();
    const id = await repo.create({ receiver_id: charId, gold: '5000' });
    await repo.markRead(id);
    assert.equal(await repo.countPending(charId), 1);
    await repo.markTakenGold(id);
    assert.equal(await repo.countPending(charId), 0);
  });

  it('remove deletes the row', async () => {
    await clearMail();
    const id = await repo.create({ receiver_id: charId, title: 'bye' });
    await repo.remove(id);
    assert.equal(await repo.findById(id), null);
    assert.deepEqual(await repo.listByReceiver(charId), []);
  });
});
