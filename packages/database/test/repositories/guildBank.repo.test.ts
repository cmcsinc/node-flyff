/**
 * guildBank.repo.ts test -- slot round-trip, upsert, clear, swap, loadAll
 * grouping, cascade.
 *
 * The invariants that matter: `UNIQUE(guild_id, slot)` makes the container
 * positional, so `moveSlot` must survive a both-occupied swap (a naive two
 * updates would collide on the index); `loadAll` groups by guild in one query
 * for the world-boot hydrate; deleting the guild takes the bank with it, so no
 * item rows outlive their owner.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import {
  GuildBankRepository,
  type GuildBankItemData,
} from '../../src/repositories/guildBank.repo';
import { up as up001 } from '../../src/migrations/001_initial';
import { up as up023 } from '../../src/migrations/023_guild';
import { up as up024 } from '../../src/migrations/024_guild_bank';

const knex = (knexModule as any).default || knexModule;

describe('guildBank.repo.ts', () => {
  let db: Knex;
  let repo: GuildBankRepository;

  async function makeGuild(id: number): Promise<void> {
    await db('guild').insert({
      id, name: `G${id}`, master_id: 1, level: 1, logo: 0, contribution_pxp: 0,
      gold: 0, notice: '', created_at_ms: 1,
    });
  }

  function item(itemId: number, over: Partial<GuildBankItemData> = {}): GuildBankItemData {
    return { itemId, count: 1, ...over };
  }

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up023(db);
    await up024(db);
    await makeGuild(1);
    await makeGuild(2);
    repo = new GuildBankRepository(db);
  });

  after(async () => { await db.destroy(); });

  it('setSlot round-trips every item instance column and touches the container', async () => {
    await repo.setSlot(1, 5, {
      itemId: 3300, count: 12, objid: 0x40001234, refine: 4,
      element: 3, elementLevel: 15, flags: 7, durability: 900,
      stats: '{"a":1}', depositedBy: 42,
    }, 1000);
    const [it] = await repo.load(1);
    assert.ok(it);
    assert.equal(it.slot, 5);
    assert.equal(it.itemId, 3300);
    assert.equal(it.count, 12);
    assert.equal(it.objid, 0x40001234);
    assert.equal(it.refine, 4);
    assert.equal(it.element, 3);
    assert.equal(it.elementLevel, 15);
    assert.equal(it.flags, 7);
    assert.equal(it.durability, 900);
    assert.equal(it.stats, '{"a":1}');
    assert.equal(it.depositedBy, 42);
    assert.equal(it.depositedAtMs, 1000);
    const meta = await db('guild_bank').where({ guild_id: 1 }).first();
    assert.equal(Number(meta.updated_at_ms), 1000);
  });

  it('defaults match the personal bank (count 1, durability -1, nullables null)', async () => {
    await repo.setSlot(1, 6, { itemId: 44 }, 1100);
    const it = (await repo.load(1)).find((x) => x.slot === 6);
    assert.ok(it);
    assert.equal(it.count, 1);
    assert.equal(it.durability, -1);
    assert.equal(it.refine, 0);
    assert.equal(it.element, 0);
    assert.equal(it.elementLevel, 0);
    assert.equal(it.flags, 0);
    assert.equal(it.objid, null);
    assert.equal(it.stats, null);
    assert.equal(it.depositedBy, null);
  });

  it('setSlot upserts -- a second write overwrites the slot, not a second row', async () => {
    await repo.setSlot(1, 5, item(99, { count: 3, refine: 0 }), 1200);
    const rows = await repo.load(1);
    assert.equal(rows.length, 2, 'still slots 5 and 6');
    const it = rows.find((x) => x.slot === 5);
    assert.ok(it);
    assert.equal(it.itemId, 99);
    assert.equal(it.count, 3);
    assert.equal(it.refine, 0, 'merged columns reset to the new values');
    assert.equal(it.depositedAtMs, 1200);
  });

  it('load orders by slot', async () => {
    await repo.setSlot(1, 0, item(1));
    const slots = (await repo.load(1)).map((x) => x.slot);
    assert.deepEqual(slots, [0, 5, 6]);
    await repo.clearSlot(1, 0);
  });

  it('clearSlot empties one slot and leaves the rest', async () => {
    await repo.clearSlot(1, 6);
    assert.deepEqual((await repo.load(1)).map((x) => x.slot), [5]);
    // Clearing an already-empty slot is a no-op, not an error.
    await repo.clearSlot(1, 6);
    assert.equal((await repo.load(1)).length, 1);
  });

  it('moveSlot swaps two occupied slots', async () => {
    await repo.setSlot(1, 10, item(111, { count: 1 }));
    await repo.setSlot(1, 11, item(222, { count: 2 }));
    await repo.moveSlot(1, 10, 11);
    const by = new Map((await repo.load(1)).map((x) => [x.slot, x]));
    assert.equal(by.get(10)?.itemId, 222);
    assert.equal(by.get(10)?.count, 2);
    assert.equal(by.get(11)?.itemId, 111);
    assert.equal(by.get(11)?.count, 1);
  });

  it('moveSlot relocates when the destination is empty', async () => {
    await repo.moveSlot(1, 11, 20);
    const by = new Map((await repo.load(1)).map((x) => [x.slot, x]));
    assert.equal(by.has(11), false, 'source vacated');
    assert.equal(by.get(20)?.itemId, 111);
    // Both empty, and src === dst, are no-ops.
    await repo.moveSlot(1, 30, 31);
    await repo.moveSlot(1, 20, 20);
    assert.equal(by.get(20)?.itemId, 111);
    assert.equal((await repo.load(1)).length, 3, 'slots 5, 10, 20');
  });

  it('loadAll groups by guild in one pass', async () => {
    await repo.setSlot(2, 1, item(700));
    await repo.setSlot(2, 0, item(701));
    const all = await repo.loadAll();
    assert.equal(all.size, 2);
    assert.deepEqual(all.get(1)?.map((x) => x.slot), [5, 10, 20]);
    assert.deepEqual(all.get(2)?.map((x) => x.itemId), [701, 700], 'ordered by slot');
  });

  it('touch upserts the lazy metadata row without any item', async () => {
    await makeGuild(3);
    assert.equal(await db('guild_bank').where({ guild_id: 3 }).first(), undefined);
    await repo.touch(3, 5000);
    await repo.touch(3, 6000);
    const rows = await db('guild_bank').where({ guild_id: 3 });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].updated_at_ms), 6000);
  });

  it('deleting the guild cascades its bank items and metadata row', async () => {
    await db('guild').where({ id: 2 }).delete();
    assert.deepEqual(await repo.load(2), []);
    assert.equal((await db('guild_bank').where({ guild_id: 2 })).length, 0);
    const all = await repo.loadAll();
    assert.equal(all.has(2), false);
  });
});
