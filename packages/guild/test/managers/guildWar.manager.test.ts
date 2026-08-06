/**
 * GuildWarManager tests -- the id allocator, the frozen roster size, the
 * normalized `nAbsent` accumulator, the timeout cascade, and the scoring gate.
 *
 * The clock is injected so the two-hour expiry is driven, never slept on, and
 * persistence is a recording object rather than Knex.
 * @module managers/guildWar.manager.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  WF_WARTIME, WF_END,
  WR_DECL_AB, WR_ACPT_AB, WR_DECL_DD, WR_ACPT_DD, WR_DRAW, WR_TRUCE,
  WR_DECL_GN, WR_ACPT_GN, WR_ACPT_SR,
  GUILD_WAR_DURATION_MS,
} from '@flyff/world-core';
import {
  GuildWarManager, type GuildWarPersistence, type War,
} from '../../src/managers/guildWar.manager';

/** A recording {@link GuildWarPersistence}. */
function fakeRepo(overrides: Partial<GuildWarPersistence> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) =>
    async (...args: unknown[]): Promise<void> => { calls.push({ method, args }); };
  const repo: GuildWarPersistence = {
    loadAll: async () => [],
    maxId: async () => 0,
    create: rec('create') as GuildWarPersistence['create'],
    update: rec('update') as GuildWarPersistence['update'],
    remove: rec('remove') as GuildWarPersistence['remove'],
    ...overrides,
  };
  return { repo, calls };
}

function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: (): number => t, advance: (ms: number): void => { t += ms; } };
}

describe('GuildWarManager', () => {
  let clock: ReturnType<typeof fakeClock>;
  let harness: ReturnType<typeof fakeRepo>;
  let mgr: GuildWarManager;

  beforeEach(() => {
    clock = fakeClock();
    harness = fakeRepo();
    mgr = new GuildWarManager(harness.repo, clock.now);
  });

  describe('addWar', () => {
    it('issues sequential ids starting at 1 -- CGuildWarMng::m_id seeds 0', () => {
      assert.equal(mgr.addWar(10, 12, 20, 15), 1);
      assert.equal(mgr.addWar(30, 12, 40, 15), 2);
    });

    it('freezes each roster size -- the 70% divisor must not follow recruitment', () => {
      const id = mgr.addWar(10, 12, 20, 15);
      const war = mgr.get(id);
      assert.ok(war);
      assert.equal(war!.decl.size, 12);
      assert.equal(war!.acpt.size, 15);
    });

    it('starts at WF_WARTIME with zeroed counters', () => {
      const war = mgr.get(mgr.addWar(10, 12, 20, 15))!;
      assert.equal(war.flag, WF_WARTIME);
      for (const side of [war.decl, war.acpt]) {
        assert.equal(side.surrender, 0);
        assert.equal(side.dead, 0);
        assert.equal(side.absent, 0);
      }
    });

    it('stores the start time in SECONDS, not milliseconds', () => {
      const war = mgr.get(mgr.addWar(10, 12, 20, 15))!;
      assert.equal(war.startedAtSec, Math.floor(clock.now() / 1000));
    });

    it('persists a create', () => {
      mgr.addWar(10, 12, 20, 15);
      assert.equal(harness.calls.filter((c) => c.method === 'create').length, 1);
    });
  });

  describe('hydrate', () => {
    it('reloads wars and seeds the id counter past the highest stored id', async () => {
      const { repo } = fakeRepo({
        loadAll: async () => [{
          id: 7,
          decl: { guildId: 10, size: 12, surrender: 1, dead: 2, absent: 3 },
          acpt: { guildId: 20, size: 15, surrender: 0, dead: 0, absent: 0 },
          flag: WF_WARTIME, startedAtSec: 1_600_000_000,
        }],
        maxId: async () => 7,
      });
      const m = new GuildWarManager(repo, clock.now);
      await m.hydrate();
      const war = m.get(7);
      assert.ok(war);
      assert.equal(war!.decl.dead, 2);
      // Next allocation must not collide with the loaded row.
      assert.equal(m.addWar(30, 10, 40, 10), 8);
    });
  });

  describe('sideOf / isDecl', () => {
    let war: War;
    beforeEach(() => { war = mgr.get(mgr.addWar(10, 12, 20, 15))!; });

    it('isDecl is true only for the declaring guild', () => {
      assert.equal(mgr.isDecl(war, 10), true);
      assert.equal(mgr.isDecl(war, 20), false);
      assert.equal(mgr.isDecl(war, 99), false);
    });

    it('sideOf returns undefined for a guild not in this war', () => {
      assert.equal(mgr.sideOf(war, 10), war.decl);
      assert.equal(mgr.sideOf(war, 20), war.acpt);
      assert.equal(mgr.sideOf(war, 99), undefined);
    });
  });

  describe('expiry', () => {
    it('is not expired one millisecond before the two-hour mark', () => {
      const war = mgr.get(mgr.addWar(10, 12, 20, 15))!;
      clock.advance(GUILD_WAR_DURATION_MS - 1);
      assert.equal(mgr.isExpired(war), false);
    });

    it('expires past two hours -- the retail arm, not the dead 10-minute one', () => {
      const war = mgr.get(mgr.addWar(10, 12, 20, 15))!;
      clock.advance(GUILD_WAR_DURATION_MS + 1000);
      assert.equal(mgr.isExpired(war), true);
    });

    it('a WF_END war is no longer "expired" -- the latch prevents double counting', () => {
      const war = mgr.get(mgr.addWar(10, 12, 20, 15))!;
      clock.advance(GUILD_WAR_DURATION_MS + 1000);
      mgr.markEnded(war);
      assert.equal(war.flag, WF_END);
      assert.equal(mgr.isExpired(war), false);
    });
  });

  describe('counters', () => {
    let war: War;
    beforeEach(() => { war = mgr.get(mgr.addWar(10, 12, 20, 15))!; });

    it('addSurrender bumps only the named side', () => {
      assert.equal(mgr.addSurrender(war, 10), 1);
      assert.equal(war.decl.surrender, 1);
      assert.equal(war.acpt.surrender, 0);
    });

    it('addSurrender for a guild not in the war is a no-op returning 0', () => {
      assert.equal(mgr.addSurrender(war, 99), 0);
      assert.equal(war.decl.surrender, 0);
    });

    it('addDead bumps only the named side', () => {
      mgr.addDead(war, 20);
      assert.equal(war.acpt.dead, 1);
      assert.equal(war.decl.dead, 0);
    });

    it('nAbsent counts WHOLE SECONDS -- sub-second ticks accumulate silently', () => {
      // C++ increments once per main-loop pass (~1ms); we normalize to 1/sec so
      // the value means seconds-offline. The comparison it feeds is unaffected.
      assert.equal(mgr.addAbsent(war, true, 400), 0);
      assert.equal(war.decl.absent, 0);
      assert.equal(mgr.addAbsent(war, true, 400), 0);
      assert.equal(mgr.addAbsent(war, true, 400), 1, '1200ms total = 1 second');
      assert.equal(war.decl.absent, 1);
    });

    it('nAbsent carries the remainder rather than dropping it', () => {
      mgr.addAbsent(war, true, 1500);
      assert.equal(war.decl.absent, 1);
      mgr.addAbsent(war, true, 500);  // 500 carried + 500 = 1000
      assert.equal(war.decl.absent, 2);
    });

    it('a long tick can add several seconds at once', () => {
      assert.equal(mgr.addAbsent(war, false, 5000), 5);
      assert.equal(war.acpt.absent, 5);
    });

    it('the two sides accumulate independently', () => {
      mgr.addAbsent(war, true, 1000);
      assert.equal(war.decl.absent, 1);
      assert.equal(war.acpt.absent, 0);
    });
  });

  describe('resolveTimeout', () => {
    let war: War;
    beforeEach(() => { war = mgr.get(mgr.addWar(10, 12, 20, 15))!; });

    it('MORE absence LOSES -- decl absent yields an ACPT win', () => {
      war.decl.absent = 5; war.acpt.absent = 2;
      assert.equal(mgr.resolveTimeout(war), WR_ACPT_AB);
    });

    it('and the mirror', () => {
      war.decl.absent = 1; war.acpt.absent = 9;
      assert.equal(mgr.resolveTimeout(war), WR_DECL_AB);
    });

    it('absence is checked BEFORE deaths -- it wins even against a death deficit', () => {
      war.decl.absent = 5; war.acpt.absent = 2;
      war.decl.dead = 0;   war.acpt.dead = 100;
      assert.equal(mgr.resolveTimeout(war), WR_ACPT_AB);
    });

    it('equal absence falls through to deaths, and MORE deaths LOSES', () => {
      war.decl.dead = 7; war.acpt.dead = 3;
      assert.equal(mgr.resolveTimeout(war), WR_ACPT_DD);
      war.decl.dead = 3; war.acpt.dead = 7;
      assert.equal(mgr.resolveTimeout(war), WR_DECL_DD);
    });

    it('everything equal is a draw', () => {
      assert.equal(mgr.resolveTimeout(war), WR_DRAW);
    });
  });

  describe('isScoring', () => {
    it('every win type scores', () => {
      for (const t of [WR_DECL_GN, WR_ACPT_GN, WR_ACPT_SR, WR_DECL_AB, WR_ACPT_DD]) {
        assert.equal(mgr.isScoring(t), true);
      }
    });

    it('TRUCE and DRAW do NOT -- Result gates on nType < WR_TRUCE', () => {
      assert.equal(mgr.isScoring(WR_TRUCE), false);
      assert.equal(mgr.isScoring(WR_DRAW), false);
    });
  });

  describe('removeWar', () => {
    it('removes and reports true, then false on a second call', () => {
      const id = mgr.addWar(10, 12, 20, 15);
      assert.equal(mgr.removeWar(id), true);
      assert.equal(mgr.get(id), undefined);
      assert.equal(mgr.removeWar(id), false);
    });

    it('does not rewind the id counter -- a new war gets a fresh id', () => {
      const first = mgr.addWar(10, 12, 20, 15);
      mgr.removeWar(first);
      assert.equal(mgr.addWar(10, 12, 20, 15), first + 1);
    });
  });

  describe('snapshot', () => {
    it('copies the sides so a later mutation cannot reach a sent packet', () => {
      const war = mgr.get(mgr.addWar(10, 12, 20, 15))!;
      const snap = mgr.snapshot(war);
      mgr.addDead(war, 10);
      assert.equal(snap.decl.dead, 0);
      assert.equal(war.decl.dead, 1);
    });
  });
});
