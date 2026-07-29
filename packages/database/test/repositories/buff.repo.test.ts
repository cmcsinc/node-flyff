/**
 * buff.repo.ts test -- deadline round-trip.
 *
 * The bug this guards: buffs used to persist `total_ms` (the originally-applied
 * duration), so every relog re-added each buff at full duration and long buffs
 * never expired. The repo now stores an absolute `expires_at_ms` and returns
 * `remainingMs` computed against the load clock, filtering lapsed rows.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { BuffRepository } from '../../src/repositories/buff.repo';
import { up as up001, down as down001 } from '../../src/migrations/001_initial';
import { up as up014 } from '../../src/migrations/014_character_buffs';
import { up as up015 } from '../../src/migrations/015_normalize_buffs';
import { up as up016 } from '../../src/migrations/016_buff_expires_at';

const knex = (knexModule as any).default || knexModule;
const BUFF_SKILL = 1;

describe('buff.repo.ts', () => {
  let db: Knex;
  let repo: BuffRepository;
  let charId: number;

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up014(db);
    await up015(db);
    await up016(db);
    repo = new BuffRepository(db);

    const [account] = await db('accounts').insert({
      username: 'bufftest', password_hash: 'hash',
    }).returning('id');
    const [row] = await db('characters').insert({
      account_id: account.id, name: 'BuffChar', slot: 0, class: 0, gender: 0,
      hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1,
      level: 1, exp: 0, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
      strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
      x: 0, y: 0, z: 0, world_id: 'world1', zone_id: 1,
    }).returning('id');
    charId = row.id;
  });

  after(async () => {
    await down001(db);
    await db.destroy();
  });

  it('returns the remaining time, not the original duration', async () => {
    const now = 1_000_000;
    // Buff cast at `now` for 1h; player relogs 45 min later.
    await repo.saveAll(charId, [
      { type: BUFF_SKILL, skillId: 150, level: 4, expiresAtMs: now + 3_600_000 },
    ]);
    const loaded = await repo.loadByCharacter(charId, now + 2_700_000);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.remainingMs, 900_000); // 15 min left, not 1h
    assert.equal(loaded[0]!.skillId, 150);
    assert.equal(loaded[0]!.level, 4);
  });

  it('drops rows whose deadline already passed', async () => {
    const now = 1_000_000;
    await repo.saveAll(charId, [
      { type: BUFF_SKILL, skillId: 150, level: 4, expiresAtMs: now + 10_000 },
      { type: BUFF_SKILL, skillId: 151, level: 1, expiresAtMs: now + 600_000 },
    ]);
    const loaded = await repo.loadByCharacter(charId, now + 60_000);
    assert.deepEqual(loaded.map((b) => b.skillId), [151]);
  });

  it('saveAll replaces the previous set', async () => {
    await repo.saveAll(charId, [{ type: BUFF_SKILL, skillId: 150, level: 4, expiresAtMs: 9e12 }]);
    await repo.saveAll(charId, [{ type: BUFF_SKILL, skillId: 200, level: 2, expiresAtMs: 9e12 }]);
    const loaded = await repo.loadByCharacter(charId, 0);
    assert.deepEqual(loaded.map((b) => b.skillId), [200]);
  });

  it('deleteByCharacter clears everything', async () => {
    await repo.saveAll(charId, [{ type: BUFF_SKILL, skillId: 150, level: 4, expiresAtMs: 9e12 }]);
    await repo.deleteByCharacter(charId);
    assert.deepEqual(await repo.loadByCharacter(charId, 0), []);
  });
});
