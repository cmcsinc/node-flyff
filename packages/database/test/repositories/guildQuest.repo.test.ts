/**
 * guildQuest.repo.ts test -- grouped hydrate, upsert idempotence, FK cascade.
 *
 * The invariants that matter: `loadAll` groups by guild id (the boot hydrate
 * feeds one list per guild), `upsert` on the same `(guild_id, quest_id)` PATCHES
 * rather than duplicating (the UNIQUE index is the conflict target, and a
 * duplicate row would let a guild hold two states for one quest), and
 * `quest_id` stays signed so the C++ `-1` tombstone value round-trips even
 * though we never store one.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { GuildQuestRepository } from '../../src/repositories/guildQuest.repo';
import { up as up001 } from '../../src/migrations/001_initial';
import { up as up023 } from '../../src/migrations/023_guild';
import { up as up026 } from '../../src/migrations/026_guild_quest';

const knex = (knexModule as any).default || knexModule;

/** QS_BEGIN / QS_END -- the two ends of the `nState` range. */
const QS_BEGIN = 0;
const QS_END = 14;

describe('guildQuest.repo.ts', () => {
  let db: Knex;
  let repo: GuildQuestRepository;

  async function makeGuild(id: number): Promise<void> {
    await db('guild').insert({
      id,
      name: `g${id}`,
      master_id: id,
      created_at_ms: 1_700_000_000_000,
    });
  }

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up023(db);
    await up026(db);
  });

  after(async () => { await db.destroy(); });

  beforeEach(async () => {
    await db('guild_quest').del();
    await db('guild').del();
    repo = new GuildQuestRepository(db);
  });

  it('loadAll is an empty Map when nothing is stored', async () => {
    const all = await repo.loadAll();
    assert.ok(all instanceof Map);
    assert.equal(all.size, 0);
  });

  it('groups entries by guild id', async () => {
    await makeGuild(10);
    await makeGuild(20);
    await repo.upsert(10, 5000, QS_BEGIN);
    await repo.upsert(10, 5001, QS_END);
    await repo.upsert(20, 5000, 3);

    const all = await repo.loadAll();
    assert.equal(all.size, 2);
    const g10 = all.get(10) ?? [];
    assert.equal(g10.length, 2);
    assert.deepEqual(
      g10.map((e) => [e.questId, e.state]).sort((a, b) => a[0]! - b[0]!),
      [[5000, QS_BEGIN], [5001, QS_END]],
    );
    assert.deepEqual(all.get(20), [{ guildId: 20, questId: 5000, state: 3 }]);
  });

  it('upsert twice on the same (guild_id, quest_id) updates in place', async () => {
    await makeGuild(10);
    await repo.upsert(10, 5000, QS_BEGIN);
    await repo.upsert(10, 5000, QS_END);

    const rows = await db('guild_quest').where({ guild_id: 10, quest_id: 5000 });
    assert.equal(rows.length, 1, 'the UNIQUE index must collapse the second write');
    const g10 = (await repo.loadAll()).get(10) ?? [];
    assert.deepEqual(g10, [{ guildId: 10, questId: 5000, state: QS_END }]);
  });

  it('upsert keeps the same quest id on different guilds separate', async () => {
    await makeGuild(10);
    await makeGuild(20);
    await repo.upsert(10, 5000, QS_BEGIN);
    await repo.upsert(20, 5000, QS_END);
    const all = await repo.loadAll();
    assert.equal(all.get(10)?.[0]?.state, QS_BEGIN);
    assert.equal(all.get(20)?.[0]?.state, QS_END);
  });

  it('remove drops one entry; a second remove is a no-op', async () => {
    await makeGuild(10);
    await repo.upsert(10, 5000, QS_BEGIN);
    await repo.upsert(10, 5001, QS_BEGIN);
    await repo.remove(10, 5000);
    const g10 = (await repo.loadAll()).get(10) ?? [];
    assert.deepEqual(g10.map((e) => e.questId), [5001]);
    await repo.remove(10, 5000);
    assert.equal(((await repo.loadAll()).get(10) ?? []).length, 1);
  });

  it('remove only touches the named guild', async () => {
    await makeGuild(10);
    await makeGuild(20);
    await repo.upsert(10, 5000, QS_BEGIN);
    await repo.upsert(20, 5000, QS_BEGIN);
    await repo.remove(10, 5000);
    const all = await repo.loadAll();
    assert.equal(all.has(10), false);
    assert.equal(all.get(20)?.length, 1);
  });

  it('quest_id is signed -- the C++ -1 tombstone value round-trips', async () => {
    // We never store a tombstone (an absent row is the tombstone), but the
    // column must not be narrowed to unsigned: -1 is what `CGuild::RemoveQuest`
    // writes on the wire.
    await makeGuild(10);
    await repo.upsert(10, -1, QS_BEGIN);
    assert.equal((await repo.loadAll()).get(10)?.[0]?.questId, -1);
  });

  it('cascades on guild delete -- orphan quest rows unwind no live state', async () => {
    await db.raw('PRAGMA foreign_keys = ON');
    await makeGuild(10);
    await repo.upsert(10, 5000, QS_BEGIN);
    await db('guild').where({ id: 10 }).del();
    assert.equal((await repo.loadAll()).size, 0);
    await db.raw('PRAGMA foreign_keys = OFF');
  });
});
