/**
 * GuildContributionService tests -- penya/gem donation, the level-up snapshot
 * push, the credit-then-debit rollback, and the 21:00 payroll sweep.
 *
 * Every case is a port of a `CDPSrvr::OnGuildContribution` branch
 * (`WORLDSERVER/DPSrvr.cpp:1837-1918`) or of `CGuildMng::Process`
 * (`_Common/guild.cpp:1089`), so each asserts the wire effect AND that the
 * inventory port was (or was not) touched.
 * @module services/guildContribution.service.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, GUD_MASTER, GUD_KINGPIN, GUD_ROOKIE } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import {
  GuildContributionService, SALARY_PAY_HOUR, SALARY_RESET_HOUR,
  type GemStack, type GuildInventoryPort,
} from '../../src/services/guildContribution.service';
import { GuildManager, type GuildPersistence } from '../../src/managers/guild.manager';
import { GUILD_TABLE, MAX_GUILD_LEVEL, gemContributionPxp } from '../../src/guildTable';

interface MockPlayer { m_idPlayer: number; m_szName: string; m_idGuild: number }

function makePlayer(id: number): MockPlayer & CPlayer {
  return { m_idPlayer: id, m_szName: `P${id}`, m_idGuild: NULL_ID } as MockPlayer & CPlayer;
}

/** Leading DWORD -- every snapshot frame starts with PACKETTYPE_SNAPSHOT. */
function op(buf: Buffer): number { return buf.readUInt32LE(0); }
/** Subtype WORD of a snapshot record (prefix is 4+4+2+4 = 14 bytes). */
function subtype(buf: Buffer): number { return buf.readUInt16LE(14); }

/** A recording {@link GuildPersistence}. */
function fakeRepo(): { repo: GuildPersistence; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) =>
    async (...args: unknown[]): Promise<void> => { calls.push({ method, args }); };
  return {
    calls,
    repo: {
      loadAll: async () => [],
      maxId: async () => 0,
      loadAllCooldowns: async () => new Map<number, number>(),
      create: rec('create') as GuildPersistence['create'],
      update: rec('update') as GuildPersistence['update'],
      addMember: rec('addMember') as GuildPersistence['addMember'],
      removeMember: rec('removeMember') as GuildPersistence['removeMember'],
      updateMember: rec('updateMember') as GuildPersistence['updateMember'],
      remove: rec('remove') as GuildPersistence['remove'],
      setCooldown: rec('setCooldown') as GuildPersistence['setCooldown'],
    },
  };
}

/** A recording {@link GuildInventoryPort} over a mutable gold/gem fixture. */
function fakeInventory(init: { gold?: number; gems?: GemStack[] } = {}) {
  const state = {
    gold: init.gold ?? 0,
    gems: init.gems ?? [],
    spendGoldOk: true,
    removeItemOk: true,
    spent: [] as number[],
    removed: [] as Array<{ slot: number; count: number }>,
    gemQueries: 0,
  };
  const inventory: GuildInventoryPort = {
    getGold: () => state.gold,
    spendGold: (_p, amount) => {
      if (!state.spendGoldOk) return false;
      state.gold -= amount;
      state.spent.push(amount);
      return true;
    },
    findGems: () => { state.gemQueries++; return state.gems; },
    removeItem: (_p, slot, count) => {
      if (!state.removeItemOk) return false;
      state.removed.push({ slot, count });
      return true;
    },
  };
  return { inventory, state };
}

function makeHarness() {
  const players = new Map<number, CPlayer>();
  const sent: Array<{ id: number; buf: Buffer }> = [];
  const playerManager = {
    get: (id: number) => players.get(id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
  };
  return { players, sent, playerManager };
}

describe('GuildContributionService', () => {
  let a: MockPlayer & CPlayer; // master
  let b: MockPlayer & CPlayer; // kingpin
  let harness: ReturnType<typeof makeHarness>;
  let manager: GuildManager;
  let repo: ReturnType<typeof fakeRepo>;
  let hour: number;
  let enabled: boolean;

  /** Build the service over the current fixtures. */
  function build(inv: GuildInventoryPort): GuildContributionService {
    return new GuildContributionService({
      playerManager: harness.playerManager as never,
      guildManager: manager,
      inventory: inv,
      guildInventoryEnabled: () => enabled,
      now: () => new Date(2026, 0, 1, hour, 0, 0),
    });
  }

  beforeEach(() => {
    a = makePlayer(1); b = makePlayer(2);
    harness = makeHarness();
    harness.players.set(1, a); harness.players.set(2, b);
    repo = fakeRepo();
    manager = new GuildManager(repo.repo, () => 1_000_000);
    hour = 12;
    enabled = true;
  });

  /** A 2-member guild: 1 = master, 2 = kingpin. */
  function guild() {
    const g = manager.create('Braves', 1, [2])!;
    manager.setMemberLevel(g.id, 2, GUD_KINGPIN);
    return g;
  }

  function reset(): void { harness.sent.length = 0; }

  describe('mode selection', () => {
    it('penya WINS over gems when both are set (C++ else-if, DPSrvr.cpp:1855)', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({
        gold: 10_000, gems: [{ slot: 3, itemId: 111, count: 4, itemLv: 5 }],
      });
      build(inventory).contribute(a, 1, 500, 1);
      assert.equal(g.gold, 500, 'the penya branch ran');
      assert.deepEqual(state.spent, [500]);
      assert.equal(state.gemQueries, 0, 'the bag was never scanned');
      assert.deepEqual(state.removed, [], 'no gem consumed');
      assert.equal(manager.getMember(g.id, 1)!.givePxp, 0, 'no PXP credited');
    });

    it('a guildless player and a disabled feature switch are both complete no-ops', () => {
      const { inventory, state } = fakeInventory({ gold: 10_000 });
      const svc = build(inventory);
      svc.contribute(makePlayer(9), 0, 500, 0); // no guild
      assert.deepEqual(state.spent, []);
      assert.equal(harness.sent.length, 0);

      const g = guild();
      enabled = false;
      svc.contribute(a, 0, 500, 0);
      assert.equal(g.gold, 0, 'ENABLE_GUILD_INVENTORY off (DPSrvr.cpp:1848)');
      assert.deepEqual(state.spent, []);
      assert.equal(state.gemQueries, 0);
      assert.equal(harness.sent.length, 0);
    });

    it('a PXP flag with no item flag donates nothing', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({
        gold: 10_000, gems: [{ slot: 0, itemId: 1, count: 1, itemLv: 3 }],
      });
      build(inventory).contribute(a, 1, 0, 0);
      assert.equal(g.contributionPxp, 0);
      assert.equal(state.gemQueries, 0);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('penya contribution', () => {
    it('refuses when the player is short -- no credit, no debit', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ gold: 499 });
      build(inventory).contribute(a, 0, 500, 0);
      assert.equal(g.gold, 0);
      assert.equal(manager.getMember(g.id, 1)!.giveGold, 0);
      assert.deepEqual(state.spent, []);
      assert.equal(harness.sent.length, 0, 'TID_GAME_GUILDNOTENGGOLD path sends no snapshot');
    });

    it('credits the guild, debits once, and tells EVERY online member', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ gold: 1_000 });
      build(inventory).contribute(a, 0, 500, 0);
      assert.equal(g.gold, 500);
      assert.equal(manager.getMember(g.id, 1)!.giveGold, 500);
      assert.deepEqual(state.spent, [500], 'spendGold called exactly once');
      assert.equal(state.gold, 500, 'and the player was charged');

      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      for (const s of harness.sent) {
        assert.equal(op(s.buf), PACKETTYPE.SNAPSHOT);
        assert.equal(subtype(s.buf), SNAPSHOTTYPE.GUILD_CONTRIBUTION);
        assert.equal(s.buf.readUInt32LE(16), g.id, 'idGuild');
        assert.equal(s.buf.readUInt32LE(20), 1, 'the DONOR id, not the recipient');
        assert.equal(s.buf.readUInt32LE(24), 0, 'dwPxpCount');
        assert.equal(s.buf.readUInt32LE(28), 500, 'dwPenya');
        assert.equal(s.buf.readUInt32LE(36), 500, 'the new guild pool');
        assert.equal(s.buf.readUInt16LE(40), 1, 'nGuildLevel is a WORD');
      }
    });

    it('skips offline members in the fan-out', () => {
      guild();
      harness.players.delete(2);
      const { inventory } = fakeInventory({ gold: 1_000 });
      build(inventory).contribute(a, 0, 500, 0);
      assert.deepEqual(harness.sent.map((s) => s.id), [1]);
    });

    it('rolls the MEMBER counter back when spendGold refuses after the credit', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ gold: 10_000 });
      const svc = build(inventory);
      svc.contribute(a, 0, 200, 0);          // a good donation first
      assert.equal(manager.getMember(g.id, 1)!.giveGold, 200);
      reset();

      state.spendGoldOk = false;
      svc.contribute(a, 0, 500, 0);
      assert.equal(
        manager.getMember(g.id, 1)!.giveGold, 200,
        'DecrementMemberContribution restored the prior value',
      );
      assert.equal(state.gold, 9_800, 'the player was not charged');
      assert.equal(harness.sent.length, 0, 'and nothing was announced');
      // Faithful-to-C++ wart: the guild-side pool KEEPS the penya. The cross-
      // server failure path in DPSrvr.cpp only decrements the member counters,
      // so do not "fix" this without changing the C++ reference too.
      assert.equal(g.gold, 700, 'guild pool intentionally keeps the 500');
    });
  });

  describe('gem contribution', () => {
    it('donates EVERY stack, valued ((itemLv+1)/2)*count', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({
        gems: [
          { slot: 2, itemId: 11, count: 4, itemLv: 1 }, // (1+1)/2 * 4 = 4
          { slot: 5, itemId: 12, count: 2, itemLv: 5 }, // (5+1)/2 * 2 = 6
        ],
      });
      assert.equal(gemContributionPxp(1, 4), 4);
      assert.equal(gemContributionPxp(5, 2), 6);

      build(inventory).contribute(a, 1, 0, 1);
      assert.equal(g.contributionPxp, 10, 'both stacks credited');
      assert.equal(manager.getMember(g.id, 1)!.givePxp, 10);
      assert.equal(g.gold, 0, 'no penya moved');
      assert.deepEqual(state.removed, [{ slot: 2, count: 4 }, { slot: 5, count: 2 }]);
      // One CONTRIBUTION snapshot per stack, per online member.
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2, 1, 2]);
      assert.equal(harness.sent[0].buf.readUInt32LE(24), 4, 'first stack pxp');
      assert.equal(harness.sent[2].buf.readUInt32LE(24), 6, 'second stack pxp');
    });

    it('skips a zero-value stack WITHOUT consuming it (if( nValue > 0 ))', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({
        gems: [
          { slot: 1, itemId: 11, count: 3, itemLv: 0 }, // worth 0
          { slot: 4, itemId: 12, count: 1, itemLv: 3 }, // worth 2
        ],
      });
      build(inventory).contribute(a, 1, 0, 1);
      assert.equal(g.contributionPxp, 2);
      assert.deepEqual(state.removed, [{ slot: 4, count: 1 }], 'the LV-0 stack stays in the bag');
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2], 'one stack announced');
    });

    it('rolls givePxp back when removeItem refuses, and announces nothing', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({
        gems: [{ slot: 2, itemId: 11, count: 4, itemLv: 1 }],
      });
      state.removeItemOk = false;
      build(inventory).contribute(a, 1, 0, 1);
      assert.equal(manager.getMember(g.id, 1)!.givePxp, 0, 'member counter rolled back');
      assert.equal(g.contributionPxp, 4, 'pool keeps it, same as the penya path');
      assert.equal(harness.sent.length, 0);
    });

    it('a max-level guild refuses every stack and consumes nothing', () => {
      const g = guild();
      g.level = MAX_GUILD_LEVEL;
      const { inventory, state } = fakeInventory({
        gems: [{ slot: 2, itemId: 11, count: 4, itemLv: 5 }],
      });
      build(inventory).contribute(a, 1, 0, 1);
      assert.equal(g.contributionPxp, 0);
      assert.deepEqual(state.removed, []);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('level-up announcement', () => {
    it('pushes the full GUILD snapshot on top of GUILD_CONTRIBUTION', () => {
      const g = guild();
      const need = GUILD_TABLE[2];
      const { inventory } = fakeInventory({ gold: need.penya * 2 });
      // Seed the PXP side so the penya donation alone trips the level-up.
      manager.addContribution(g.id, 1, need.pxp, 0);
      reset();

      build(inventory).contribute(a, 0, need.penya, 0);
      assert.equal(g.level, 2, 'leveled');
      assert.equal(harness.sent.length, 4, '2 packets x 2 online members');
      for (const id of [1, 2]) {
        const mine = harness.sent.filter((s) => s.id === id).map((s) => s.buf);
        assert.equal(mine.length, 2);
        assert.equal(subtype(mine[0]), SNAPSHOTTYPE.GUILD_CONTRIBUTION);
        assert.equal(subtype(mine[1]), SNAPSHOTTYPE.GUILD, 'full snapshot follows');
        assert.notDeepEqual(mine[0], mine[1]);
      }
    });

    it('sends only GUILD_CONTRIBUTION when no level-up happened', () => {
      guild();
      const { inventory } = fakeInventory({ gold: 10 });
      build(inventory).contribute(a, 0, 10, 0);
      assert.equal(harness.sent.length, 2);
      for (const s of harness.sent) assert.equal(subtype(s.buf), SNAPSHOTTYPE.GUILD_CONTRIBUTION);
    });
  });

  describe('tickSalary', () => {
    /** A guild with a funded bank and different salaries per rank. */
    function payroll() {
      const g = guild();
      g.penya[GUD_MASTER] = 100;
      g.penya[GUD_KINGPIN] = 50;
      g.gold = 1_000;
      return g;
    }

    it('pays at 21:00 and sends GUILD_REAL_PENYA with the NEW gold + each own rank', () => {
      const g = payroll();
      const { inventory } = fakeInventory();
      hour = SALARY_PAY_HOUR;
      build(inventory).tickSalary();

      assert.equal(g.gold, 850, '1000 - (100 + 50)');
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      for (const s of harness.sent) {
        assert.equal(subtype(s.buf), SNAPSHOTTYPE.GUILD_REAL_PENYA);
        assert.equal(s.buf.readUInt32LE(16), 850, 'the guild bank AFTER the payout');
      }
      // nType is the RECIPIENT's rank (DPCoreClient.cpp:2484) -- two members at
      // different ranks must get different values.
      assert.equal(harness.sent[0].buf.readUInt32LE(20), GUD_MASTER);
      assert.equal(harness.sent[1].buf.readUInt32LE(20), GUD_KINGPIN);
      assert.notEqual(
        harness.sent[0].buf.readUInt32LE(20), harness.sent[1].buf.readUInt32LE(20),
      );
    });

    it('is latched -- a second 21:00 tick pays nothing', () => {
      const g = payroll();
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      hour = SALARY_PAY_HOUR;
      svc.tickSalary();
      reset();
      svc.tickSalary();
      svc.tickSalary();
      assert.equal(g.gold, 850, 'paid exactly once');
      assert.equal(manager.getMember(g.id, 1)!.pay, 100);
      assert.equal(harness.sent.length, 0);
    });

    it('hour 22 clears the latch so the next evening pays again', () => {
      const g = payroll();
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      hour = SALARY_PAY_HOUR; svc.tickSalary();
      hour = SALARY_RESET_HOUR; svc.tickSalary();
      assert.equal(g.sentPay, false, 'per-guild latch cleared too');
      reset();
      hour = SALARY_PAY_HOUR; svc.tickSalary();
      assert.equal(g.gold, 700, 'a second payout landed');
      assert.equal(manager.getMember(g.id, 1)!.pay, 200);
      assert.equal(harness.sent.length, 2);
    });

    it('does nothing at any other hour', () => {
      const g = payroll();
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      for (const h of [0, 12, 20, 23]) { hour = h; svc.tickSalary(); }
      assert.equal(g.gold, 1_000);
      assert.equal(harness.sent.length, 0);
    });

    it('skips a guild that cannot afford its full payroll', () => {
      const g = payroll();
      g.gold = 149;
      const { inventory } = fakeInventory();
      hour = SALARY_PAY_HOUR;
      build(inventory).tickSalary();
      assert.equal(g.gold, 149, 'all-or-nothing');
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('isMaxLevel', () => {
    it('is true only at the cap, false for an unknown guild', () => {
      const g = guild();
      const svc = build(fakeInventory().inventory);
      assert.equal(svc.isMaxLevel(g.id), false);
      g.level = MAX_GUILD_LEVEL;
      assert.equal(svc.isMaxLevel(g.id), true);
      assert.equal(svc.isMaxLevel(999), false);
    });
  });

  describe('gemContributionPxp edges', () => {
    it('clamps 0 and negative inputs to 0 and truncates the division', () => {
      assert.equal(gemContributionPxp(0, 5), 0);
      assert.equal(gemContributionPxp(5, 0), 0);
      assert.equal(gemContributionPxp(-1, 5), 0);
      assert.equal(gemContributionPxp(5, -2), 0);
      assert.equal(gemContributionPxp(1, 1), 1);
      assert.equal(gemContributionPxp(2, 1), 1, 'integer division: LV1 and LV2 both 1');
      assert.equal(gemContributionPxp(5, 1), 3);
      assert.equal(GUD_ROOKIE >= 0, true);
    });
  });
});
