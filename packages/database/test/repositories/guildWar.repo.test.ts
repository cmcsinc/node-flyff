/**
 * guildWar.repo.ts test -- round-trip, id seed, counter patch, delete.
 *
 * The invariants that matter: `started_at_sec` stays SECONDS (it is the 32-bit
 * `time_t` that goes on the wire), `flag` stays the numeric WF_* character code
 * rather than being coerced to a string, and each side's counters patch
 * independently -- `OnWarTimeout` compares them, so a cross-contaminated write
 * would change who wins.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { GuildWarRepository, type GuildWar } from '../../src/repositories/guildWar.repo';
import { up as up001 } from '../../src/migrations/001_initial';
import { up as up023 } from '../../src/migrations/023_guild';
import { up as up025 } from '../../src/migrations/025_guild_war';

const knex = (knexModule as any).default || knexModule;

/** WF_WARTIME -- the character '0', not the integer 0. */
const WF_WARTIME = 0x30;
/** WF_END -- the character '9'. */
const WF_END = 0x39;

describe('guildWar.repo.ts', () => {
  let db: Knex;
  let repo: GuildWarRepository;

  function war(id: number, over: Partial<GuildWar> = {}): GuildWar {
    return {
      id,
      decl: { guildId: 10, size: 12, surrender: 0, dead: 0, absent: 0 },
      acpt: { guildId: 20, size: 15, surrender: 0, dead: 0, absent: 0 },
      flag: WF_WARTIME,
      startedAtSec: 1_700_000_000,
      ...over,
    };
  }

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up023(db);
    await up025(db);
  });

  after(async () => { await db.destroy(); });

  beforeEach(async () => { await db('guild_war').del(); });

  it('round-trips both sides with their own counters', async () => {
    repo = new GuildWarRepository(db);
    await repo.create(war(1, {
      decl: { guildId: 10, size: 12, surrender: 1, dead: 2, absent: 3 },
      acpt: { guildId: 20, size: 15, surrender: 4, dead: 5, absent: 6 },
    }));
    const [loaded] = await repo.loadAll();
    assert.ok(loaded);
    assert.equal(loaded!.decl.guildId, 10);
    assert.deepEqual(
      [loaded!.decl.size, loaded!.decl.surrender, loaded!.decl.dead, loaded!.decl.absent],
      [12, 1, 2, 3],
    );
    assert.deepEqual(
      [loaded!.acpt.size, loaded!.acpt.surrender, loaded!.acpt.dead, loaded!.acpt.absent],
      [15, 4, 5, 6],
    );
  });

  it('keeps the flag as a numeric WF_* character code', async () => {
    repo = new GuildWarRepository(db);
    await repo.create(war(1, { flag: WF_END }));
    const [loaded] = await repo.loadAll();
    assert.equal(loaded!.flag, WF_END, 'the byte 0x39, not the string "9"');
    assert.equal(typeof loaded!.flag, 'number');
  });

  it('stores the start time in SECONDS -- an ms value would not survive the wire cast', async () => {
    repo = new GuildWarRepository(db);
    const sec = 1_700_000_000;
    await repo.create(war(1, { startedAtSec: sec }));
    const [loaded] = await repo.loadAll();
    assert.equal(loaded!.startedAtSec, sec);
    // Sanity: the same instant in ms would overflow the 32-bit time_t the client
    // reads, so this must never be stored as Date.now().
    assert.ok(loaded!.startedAtSec < 0xffff_ffff);
  });

  it('maxId seeds the id counter past every stored war, and is 0 when empty', async () => {
    repo = new GuildWarRepository(db);
    assert.equal(await repo.maxId(), 0);
    await repo.create(war(3));
    await repo.create(war(7));
    assert.equal(await repo.maxId(), 7);
  });

  it('update patches only the named columns; an empty patch is a no-op', async () => {
    repo = new GuildWarRepository(db);
    await repo.create(war(1));
    await repo.update(1, { decl_dead: 5 });
    let [loaded] = await repo.loadAll();
    assert.equal(loaded!.decl.dead, 5);
    assert.equal(loaded!.acpt.dead, 0, 'the other side is untouched');
    assert.equal(loaded!.flag, WF_WARTIME);
    // An empty patch must not become `UPDATE ... SET` with no assignments.
    await repo.update(1, {});
    [loaded] = await repo.loadAll();
    assert.equal(loaded!.decl.dead, 5);
  });

  it('the WF_END latch is a flag patch, not a delete', async () => {
    repo = new GuildWarRepository(db);
    await repo.create(war(1));
    await repo.update(1, { flag: WF_END });
    const [loaded] = await repo.loadAll();
    assert.equal(loaded!.flag, WF_END);
  });

  it('remove drops the war; a second remove is a no-op', async () => {
    repo = new GuildWarRepository(db);
    await repo.create(war(1));
    await repo.remove(1);
    assert.equal((await repo.loadAll()).length, 0);
    await repo.remove(1);
    assert.equal((await repo.loadAll()).length, 0);
  });

  it('is NOT FK-bound to guild -- a disbanded guild must not silently delete the war', async () => {
    // The service ends the war explicitly when a guild disappears; an ON DELETE
    // CASCADE here would drop the row first and skip that resolution.
    repo = new GuildWarRepository(db);
    await assert.doesNotReject(() => repo.create(war(1, {
      decl: { guildId: 9999, size: 1, surrender: 0, dead: 0, absent: 0 },
      acpt: { guildId: 8888, size: 1, surrender: 0, dead: 0, absent: 0 },
    })));
  });
});
