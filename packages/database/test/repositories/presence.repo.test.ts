/**
 * presence.repo.ts test -- upsert idempotence + staleness window.
 *
 * Presence is keyed by `character_id` (the table PK), so a re-JOIN must refresh
 * the existing row rather than add a second one. Readers must never see a
 * character whose heartbeat lapsed (crashed world), hence the `listOnline`
 * freshness filter.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { PresenceRepository } from '../../src/repositories/presence.repo';
import { up as up001, down as down001 } from '../../src/migrations/001_initial';
import { up as up017 } from '../../src/migrations/017_presence_and_mail';

const knex = (knexModule as any).default || knexModule;

describe('presence.repo.ts', () => {
  let db: Knex;
  let repo: PresenceRepository;
  let charA: number;
  let charB: number;

  async function makeChar(name: string, accountId: number, slot: number): Promise<number> {
    const [row] = await db('characters').insert({
      account_id: accountId, name, slot, class: 0, gender: 0,
      hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1,
      level: 1, exp: 0, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
      strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
      x: 0, y: 0, z: 0, world_id: 'world1', zone_id: 1,
    }).returning('id');
    return row.id;
  }

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up017(db);
    repo = new PresenceRepository(db);

    const [account] = await db('accounts').insert({
      username: 'presencetest', password_hash: 'hash',
    }).returning('id');
    charA = await makeChar('PresenceA', account.id, 0);
    charB = await makeChar('PresenceB', account.id, 1);
  });

  after(async () => {
    await db.schema.dropTableIfExists('mail');
    await db.schema.dropTableIfExists('online_players');
    await down001(db);
    await db.destroy();
  });

  it('upsert then re-upsert keeps exactly one row and refreshes it', async () => {
    const base = { character_id: charA, account_id: 1, world_id: 'world1', zone_id: 1, server_id: 'w1' };
    await repo.upsert(base, 1_000_000);
    await repo.upsert({ ...base, zone_id: 7, server_id: 'w2' }, 1_050_000);

    const rows = await repo.listOnline(60_000, 1_050_000);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.character_id, charA);
    assert.equal(rows[0]!.zone_id, 7);
    assert.equal(rows[0]!.server_id, 'w2');
    assert.equal(rows[0]!.last_seen_ms, 1_050_000);
  });

  it('listOnline excludes rows outside the freshness window', async () => {
    await repo.upsert(
      { character_id: charB, account_id: 1, world_id: 'world1', zone_id: 1, server_id: 'w1' },
      1_000_000,
    );
    // charA fresh at 1_050_000, charB stale (50s + 60s window later).
    const rows = await repo.listOnline(60_000, 1_100_000);
    assert.deepEqual(rows.map((r) => r.character_id), [charA]);
  });

  it('touch bumps only last_seen_ms', async () => {
    await repo.touch(charB, 2_000_000);
    const rows = await repo.listOnline(60_000, 2_000_001);
    const b = rows.find((r) => r.character_id === charB);
    assert.ok(b, 'charB should be online again after touch');
    assert.equal(b!.last_seen_ms, 2_000_000);
    assert.equal(b!.server_id, 'w1');
  });

  it('touch on an absent character inserts nothing', async () => {
    await repo.remove(charB);
    await repo.touch(charB, 3_000_000);
    const rows = await repo.listOnline(60_000, 3_000_001);
    assert.deepEqual(rows.map((r) => r.character_id), []);
  });

  it('clearByServer drops that server\'s rows only', async () => {
    await repo.upsert(
      { character_id: charA, account_id: 1, world_id: 'world1', zone_id: 1, server_id: 'w2' },
      3_000_000,
    );
    await repo.upsert(
      { character_id: charB, account_id: 1, world_id: 'world1', zone_id: 1, server_id: 'w9' },
      3_000_000,
    );
    await repo.clearByServer('w2'); // charA's server
    const rows = await repo.listOnline(60_000, 3_000_001);
    assert.deepEqual(rows.map((r) => r.character_id), [charB]);
  });
});
