/**
 * GuildManager tests -- create/name index/roster caps/rejoin cooldown/rank
 * helpers/authority mask/write-once logo/hydrate.
 *
 * The clock is injected (`now`) so the 2-day cooldown is driven, never slept on,
 * and persistence is a plain recording object rather than Knex.
 * @module managers/guild.manager.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  GUD_MASTER, GUD_KINGPIN, GUD_CAPTAIN, GUD_ROOKIE, MAX_GM_LEVEL,
  GUILD_MASTER_POWER, MAX_MEMBER_LV_SIZE, PF_INVITATION, PF_MEMBERLEVEL,
} from '@flyff/world-core';
import { GuildManager, type GuildPersistence, type Guild } from '../../src/managers/guild.manager';
import {
  guildMaxMembers, guildMaxRankMembers, GUILD_REJOIN_COOLDOWN_MS,
  GUILD_TABLE, MAX_GUILD_LEVEL, MAX_DWORD, MAX_INT32,
  CONTRIBUTION_OK, CONTRIBUTION_FAIL_MAXLEVEL,
  CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP, CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA,
  CONTRIBUTION_FAIL_INVALID_CONDITION,
  CONTRIBUTION_FAIL_OVERFLOW_PXP, CONTRIBUTION_FAIL_OVERFLOW_PENYA,
} from '../../src/guildTable';

/** A recording {@link GuildPersistence} -- every call resolves immediately. */
function fakeRepo(overrides: Partial<GuildPersistence> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) =>
    async (...args: unknown[]): Promise<void> => { calls.push({ method, args }); };
  const repo: GuildPersistence = {
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
    ...overrides,
  };
  return { repo, calls };
}

/** A drivable clock. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: (): number => t, advance: (ms: number): void => { t += ms; } };
}

describe('GuildManager', () => {
  let clock: ReturnType<typeof fakeClock>;
  let harness: ReturnType<typeof fakeRepo>;
  let mgr: GuildManager;

  beforeEach(() => {
    clock = fakeClock();
    harness = fakeRepo();
    mgr = new GuildManager(harness.repo, clock.now);
  });

  describe('create', () => {
    it('seeds the master mask, level 1, master at rank 0, extras at GUD_ROOKIE', () => {
      const g = mgr.create('Braves', 1, [2, 3]);
      assert.ok(g);
      assert.equal(g!.level, 1);
      assert.equal(g!.logo, 0);
      assert.equal(g!.masterId, 1);
      assert.equal(g!.power.length, MAX_GM_LEVEL);
      assert.equal(g!.power[GUD_MASTER], GUILD_MASTER_POWER, '0xFF hardcoded on create');
      assert.deepEqual(g!.power.slice(1), [0, 0, 0, 0], 'every other rank starts powerless');
      assert.deepEqual(g!.penya, [0, 0, 0, 0, 0]);
      assert.deepEqual(
        g!.members.map((m) => [m.characterId, m.memberLv]),
        [[1, GUD_MASTER], [2, GUD_ROOKIE], [3, GUD_ROOKIE]],
      );
      assert.equal(harness.calls.filter((c) => c.method === 'create').length, 1);
    });

    it('dedupes the master out of memberIds', () => {
      const g = mgr.create('Braves', 1, [1, 2, 1]);
      assert.deepEqual(g!.members.map((m) => m.characterId), [1, 2]);
      assert.equal(mgr.rankCount(g!.id, GUD_MASTER), 1, 'exactly one master');
    });

    it('refuses a duplicate name, case-insensitively', () => {
      const first = mgr.create('Braves', 1);
      assert.ok(first);
      assert.equal(mgr.create('braves', 2), undefined);
      assert.equal(mgr.create('  BRAVES  ', 3), undefined, 'trimmed + folded');
      assert.equal(mgr.all().length, 1);
    });

    it('auto-increments the id', () => {
      const a = mgr.create('A', 1)!;
      const b = mgr.create('B', 2)!;
      assert.equal(b.id, a.id + 1);
      assert.equal(mgr.idCounter, b.id + 1);
    });
  });

  describe('name index', () => {
    it('getByName is case-insensitive', () => {
      const g = mgr.create('Braves', 1)!;
      assert.equal(mgr.getByName('braves'), g);
      assert.equal(mgr.getByName('BRAVES'), g);
      assert.equal(mgr.getByName('  braves '), g);
      assert.equal(mgr.getByName('nope'), undefined);
    });

    it('rename moves the index entry', () => {
      const g = mgr.create('Braves', 1)!;
      assert.ok(mgr.rename(g.id, 'Heroes'));
      assert.equal(mgr.getByName('Braves'), undefined, 'old name stops resolving');
      assert.equal(mgr.getByName('heroes'), g);
      assert.equal(g.name, 'Heroes');
    });

    it('rename refuses a clash with a DIFFERENT guild but allows a self-rename', () => {
      const a = mgr.create('Alpha', 1)!;
      mgr.create('Beta', 2);
      assert.equal(mgr.rename(a.id, 'beta'), undefined, 'other guild owns the name');
      assert.equal(a.name, 'Alpha', 'unchanged on refusal');
      assert.ok(mgr.rename(a.id, 'ALPHA'), 'renaming to your own name is allowed');
      assert.equal(a.name, 'ALPHA');
      assert.equal(mgr.getByName('alpha'), a);
    });

    it('rename on an unknown guild returns undefined', () => {
      assert.equal(mgr.rename(999, 'Ghost'), undefined);
    });
  });

  describe('addMember', () => {
    it('adds at GUD_ROOKIE and persists', () => {
      const g = mgr.create('Braves', 1)!;
      assert.ok(mgr.addMember(g.id, 2));
      assert.equal(mgr.getMember(g.id, 2)!.memberLv, GUD_ROOKIE);
      const add = harness.calls.filter((c) => c.method === 'addMember');
      assert.deepEqual(add[0].args, [g.id, 2, GUD_ROOKIE]);
    });

    it('refuses a duplicate', () => {
      const g = mgr.create('Braves', 1, [2])!;
      assert.equal(mgr.addMember(g.id, 2), undefined);
      assert.equal(mgr.addMember(g.id, 1), undefined, 'the master counts too');
      assert.equal(g.members.length, 2);
    });

    it('refuses past guildMaxMembers(level)', () => {
      const g = mgr.create('Braves', 1)!;
      const cap = guildMaxMembers(1);
      assert.equal(cap, 30);
      for (let id = 2; id <= cap; id++) assert.ok(mgr.addMember(g.id, id), `member ${id}`);
      assert.equal(g.members.length, cap);
      assert.equal(mgr.addMember(g.id, 9999), undefined, 'roster full');
      assert.equal(g.members.length, cap);
    });

    it('refuses on an unknown guild', () => {
      assert.equal(mgr.addMember(999, 2), undefined);
    });
  });

  describe('removeMember + rejoin cooldown', () => {
    it('stamps the cooldown, which expires on the injected clock', () => {
      const g = mgr.create('Braves', 1, [2])!;
      assert.equal(mgr.onCooldown(2), false);
      assert.ok(mgr.removeMember(g.id, 2));
      assert.equal(g.members.length, 1);
      assert.equal(mgr.onCooldown(2), true, 'locked out immediately after leaving');
      const stamp = harness.calls.find((c) => c.method === 'setCooldown');
      assert.deepEqual(stamp!.args, [2, clock.now() + GUILD_REJOIN_COOLDOWN_MS]);

      clock.advance(GUILD_REJOIN_COOLDOWN_MS - 1);
      assert.equal(mgr.onCooldown(2), true, 'still locked out 1ms early');
      clock.advance(1);
      assert.equal(mgr.onCooldown(2), false, 'expired exactly at the boundary');
    });

    it('returns undefined for a non-member and stamps nothing', () => {
      const g = mgr.create('Braves', 1)!;
      assert.equal(mgr.removeMember(g.id, 42), undefined);
      assert.equal(mgr.removeMember(999, 1), undefined);
      assert.equal(mgr.onCooldown(42), false);
    });
  });

  describe('destroy', () => {
    it('cools down EVERY member and clears the name index', () => {
      const g = mgr.create('Braves', 1, [2, 3])!;
      const removed = mgr.destroy(g.id);
      assert.ok(removed);
      assert.deepEqual(removed!.members.map((m) => m.characterId), [1, 2, 3]);
      for (const id of [1, 2, 3]) assert.equal(mgr.onCooldown(id), true, `member ${id} cooled`);
      assert.equal(mgr.get(g.id), undefined);
      assert.equal(mgr.getByName('Braves'), undefined, 'name freed for reuse');
      assert.ok(mgr.create('Braves', 9), 'name is reusable after a disband');
      assert.equal(mgr.destroy(999), undefined);
    });
  });

  describe('rank mutations', () => {
    it('setMemberLevel resets memberClass to 0 (C++ :1510)', () => {
      const g = mgr.create('Braves', 1, [2])!;
      mgr.setMemberClass(g.id, 2, 2);
      assert.equal(mgr.getMember(g.id, 2)!.memberClass, 2);
      const m = mgr.setMemberLevel(g.id, 2, GUD_CAPTAIN);
      assert.equal(m!.memberLv, GUD_CAPTAIN);
      assert.equal(m!.memberClass, 0, 'class always reset on a rank change');
      assert.equal(mgr.setMemberLevel(g.id, 999, GUD_CAPTAIN), undefined);
    });

    it('changeMaster swaps ranks, zeroes both classes, updates masterId', () => {
      const g = mgr.create('Braves', 1, [2])!;
      mgr.setMemberLevel(g.id, 2, GUD_KINGPIN);
      mgr.setMemberClass(g.id, 2, 1);
      mgr.setMemberClass(g.id, 1, 2);
      assert.ok(mgr.changeMaster(g.id, 1, 2));
      assert.equal(g.masterId, 2);
      assert.equal(mgr.isMaster(g.id, 2), true);
      assert.equal(mgr.isMaster(g.id, 1), false);
      const oldM = mgr.getMember(g.id, 1)!;
      const newM = mgr.getMember(g.id, 2)!;
      assert.equal(oldM.memberLv, GUD_ROOKIE, 'old master demoted to rookie');
      assert.equal(newM.memberLv, GUD_MASTER);
      assert.equal(oldM.memberClass, 0);
      assert.equal(newM.memberClass, 0);
    });

    it('changeMaster refuses when either side is not a member', () => {
      const g = mgr.create('Braves', 1, [2])!;
      assert.equal(mgr.changeMaster(g.id, 1, 999), undefined);
      assert.equal(mgr.changeMaster(g.id, 999, 2), undefined);
      assert.equal(mgr.changeMaster(999, 1, 2), undefined);
      assert.equal(g.masterId, 1);
    });

    it('setMemberAlias records the nickname', () => {
      const g = mgr.create('Braves', 1, [2])!;
      assert.equal(mgr.setMemberAlias(g.id, 2, 'Scout')!.alias, 'Scout');
      assert.equal(mgr.setMemberAlias(g.id, 999, 'X'), undefined);
    });
  });

  describe('logo (write-once)', () => {
    it('a second setLogo returns undefined and keeps the first logo', () => {
      const g = mgr.create('Braves', 1)!;
      assert.ok(mgr.setLogo(g.id, 5));
      assert.equal(g.logo, 5);
      assert.equal(mgr.setLogo(g.id, 9), undefined, 'CGuild::SetLogo refuses a rewrite');
      assert.equal(g.logo, 5);
      assert.equal(mgr.setLogo(999, 1), undefined);
    });
  });

  describe('authority mask', () => {
    it('setAuthority force-restores power[0] = 0xFF even when passed 0', () => {
      const g = mgr.create('Braves', 1)!;
      const updated = mgr.setAuthority(g.id, [0, PF_INVITATION, PF_MEMBERLEVEL, 0, 0]);
      assert.ok(updated);
      assert.equal(updated!.power[GUD_MASTER], GUILD_MASTER_POWER, 'master cannot be stranded');
      assert.deepEqual(updated!.power.slice(1), [PF_INVITATION, PF_MEMBERLEVEL, 0, 0]);
    });

    it('setAuthority pads a short array and ignores extras', () => {
      const g = mgr.create('Braves', 1)!;
      const updated = mgr.setAuthority(g.id, [0, PF_INVITATION])!;
      assert.equal(updated.power.length, MAX_GM_LEVEL);
      assert.deepEqual(updated.power.slice(2), [0, 0, 0]);
      assert.equal(mgr.setAuthority(999, []), undefined);
    });

    it('rankHasPower reads the mask per rank', () => {
      const g = mgr.create('Braves', 1)!;
      assert.equal(mgr.rankHasPower(g.id, GUD_MASTER, PF_INVITATION), true, '0xFF holds every bit');
      assert.equal(mgr.rankHasPower(g.id, GUD_ROOKIE, PF_INVITATION), false);
      mgr.setAuthority(g.id, [0, PF_INVITATION, 0, 0, 0]);
      assert.equal(mgr.rankHasPower(g.id, GUD_KINGPIN, PF_INVITATION), true);
      assert.equal(mgr.rankHasPower(g.id, GUD_KINGPIN, PF_MEMBERLEVEL), false);
      assert.equal(mgr.rankHasPower(g.id, 99, PF_INVITATION), false, 'out-of-range rank');
      assert.equal(mgr.rankHasPower(999, GUD_MASTER, PF_INVITATION), false, 'unknown guild');
    });
  });

  describe('rank counts + caps', () => {
    it('rankCount counts holders of one rank', () => {
      const g = mgr.create('Braves', 1, [2, 3, 4])!;
      assert.equal(mgr.rankCount(g.id, GUD_MASTER), 1);
      assert.equal(mgr.rankCount(g.id, GUD_ROOKIE), 3);
      mgr.setMemberLevel(g.id, 2, GUD_KINGPIN);
      assert.equal(mgr.rankCount(g.id, GUD_KINGPIN), 1);
      assert.equal(mgr.rankCount(g.id, GUD_ROOKIE), 2);
      assert.equal(mgr.rankCount(999, GUD_ROOKIE), 0);
    });

    it('maxMembers / maxRankMembers follow the level table', () => {
      const g = mgr.create('Braves', 1)!;
      assert.equal(mgr.maxMembers(g.id), 30);
      assert.equal(mgr.maxRankMembers(g.id, GUD_MASTER), MAX_MEMBER_LV_SIZE[GUD_MASTER]);
      assert.equal(mgr.maxRankMembers(g.id, GUD_KINGPIN), MAX_MEMBER_LV_SIZE[GUD_KINGPIN]);
      // GUD_ROOKIE is uncapped beyond the whole-guild limit (guild.cpp:499).
      assert.equal(mgr.maxRankMembers(g.id, GUD_ROOKIE), guildMaxMembers(1));
      assert.equal(mgr.maxRankMembers(g.id, 99), 0);
      assert.equal(mgr.maxMembers(999), 0);
      g.level = 50;
      assert.equal(mgr.maxMembers(g.id), 80, 'level 50 raises the roster cap');
      assert.equal(guildMaxRankMembers(GUD_CAPTAIN, 50), MAX_MEMBER_LV_SIZE[GUD_CAPTAIN]);
    });
  });

  describe('hydrate', () => {
    const row = (id: number, name: string, memberIds: number[]) => ({
      id, name, masterId: memberIds[0], level: 3, logo: 7,
      contributionPxp: 111, gold: 222, notice: 'hi',
      // A hand-edited DB row that zeroes the master mask must not lock them out.
      power: [0, 1, 2, 3, 4], penya: [0, 10, 20, 30, 40],
      win: 1, lose: 2, surrender: 3,
      members: memberIds.map((cid, i) => ({
        characterId: cid, memberLv: i === 0 ? GUD_MASTER : GUD_ROOKIE, memberClass: 1,
        pay: 5, giveGold: 6, givePxp: 7, win: 8, lose: 9, surrender: 0,
        alias: `A${cid}`, selectedVoteId: 0,
      })),
    });

    it('restores guilds, forces the master mask, and seeds the id counter', async () => {
      const clk = fakeClock();
      const h = fakeRepo({
        loadAll: async () => [row(4, 'Braves', [1, 2]), row(9, 'Heroes', [3])],
        maxId: async () => 9,
      });
      const m = new GuildManager(h.repo, clk.now);
      await m.hydrate();
      const g = m.get(4)!;
      assert.ok(g);
      assert.equal(g.name, 'Braves');
      assert.equal(g.level, 3);
      assert.equal(g.logo, 7);
      assert.equal(g.contributionPxp, 111);
      assert.equal(g.gold, 222);
      assert.equal(g.notice, 'hi');
      assert.equal(g.power[GUD_MASTER], GUILD_MASTER_POWER, 're-forced on load (:2837)');
      assert.deepEqual(g.power.slice(1), [1, 2, 3, 4], 'other ranks load as stored');
      assert.deepEqual(g.penya, [0, 10, 20, 30, 40]);
      assert.deepEqual(g.members.map((mm) => mm.characterId), [1, 2]);
      assert.equal(m.getMember(4, 2)!.alias, 'A2');
      assert.equal(m.getByName('braves'), g, 'name index rebuilt');
      assert.equal(m.getByName('HEROES')!.id, 9);
      // A fresh guild must not collide with a hydrated id.
      assert.equal(m.idCounter, 10);
      assert.equal(m.create('New', 50)!.id, 10);
    });

    it('drops expired cooldowns and keeps live ones', async () => {
      const clk = fakeClock(1_000_000);
      const h = fakeRepo({
        loadAll: async () => [],
        maxId: async () => 0,
        loadAllCooldowns: async () => new Map<number, number>([
          [1, clk.now() + 60_000],  // live
          [2, clk.now() - 1],       // expired
          [3, clk.now()],           // exactly now -> not > now, dropped
        ]),
      });
      const m = new GuildManager(h.repo, clk.now);
      await m.hydrate();
      assert.equal(m.onCooldown(1), true);
      assert.equal(m.onCooldown(2), false);
      assert.equal(m.onCooldown(3), false);
      clk.advance(60_000);
      assert.equal(m.onCooldown(1), false, 'live entry expires on the clock');
    });

    it('is a no-op with no repo (pure in-memory mode)', async () => {
      const m = new GuildManager();
      await m.hydrate();
      assert.deepEqual(m.all(), []);
      const g = m.create('Solo', 1)!;
      assert.ok(g, 'mutations still work without persistence');
      assert.equal(m.idCounter, 2);
    });
  });

  describe('pending invites', () => {
    it('CRUD + onDisconnect drops invites in both directions', () => {
      const g = mgr.create('Braves', 1)!;
      const mk = (inviterId: number, targetId: number) => ({
        guildId: g.id, inviterId, targetId, expiresAt: 0,
        timer: setTimeout(() => {}, 1000),
      });
      mgr.addPending(mk(1, 2));
      assert.equal(mgr.hasPending(2), true);
      assert.equal(mgr.getPending(2)!.inviterId, 1);
      assert.equal(mgr.removePending(2)!.targetId, 2);
      assert.equal(mgr.removePending(2), undefined);

      mgr.addPending(mk(1, 5));   // inviter disconnects
      mgr.addPending(mk(7, 8));   // unrelated
      mgr.onDisconnect(1);
      assert.equal(mgr.hasPending(5), false, 'inviter-side invite dropped');
      assert.equal(mgr.hasPending(8), true, 'unrelated invite untouched');
      mgr.onDisconnect(8);
      assert.equal(mgr.hasPending(8), false, 'target-side invite dropped');
    });
  });

  it('getByMember resolves a guild from any member', () => {
    const g = mgr.create('Braves', 1, [2])!;
    assert.equal(mgr.getByMember(1), g);
    assert.equal(mgr.getByMember(2), g);
    assert.equal(mgr.getByMember(99), undefined);
  });

  it('setRankPenya bounds the rank index', () => {
    const g = mgr.create('Braves', 1)!;
    assert.ok(mgr.setRankPenya(g.id, GUD_ROOKIE, 500));
    assert.equal(g.penya[GUD_ROOKIE], 500);
    assert.equal(mgr.setRankPenya(g.id, -1, 500), undefined);
    assert.equal(mgr.setRankPenya(g.id, MAX_GM_LEVEL, 500), undefined);
    assert.equal(mgr.setRankPenya(999, 0, 1), undefined);
  });

  it('setNotice records the notice', () => {
    const g = mgr.create('Braves', 1)!;
    assert.equal(mgr.setNotice(g.id, 'raid at 9')!.notice, 'raid at 9');
    assert.equal(mgr.setNotice(999, 'x'), undefined);
  });

  // ── Contribution / level-up (guild.cpp:554-607) ─────────────────────────────

  describe('canContribute', () => {
    it('FAIL_INVALID_CONDITION for an unknown guild and for a non-member', () => {
      const g = mgr.create('Braves', 1)!;
      assert.equal(mgr.canContribute(999, 1, 10, 10), CONTRIBUTION_FAIL_INVALID_CONDITION);
      assert.equal(mgr.canContribute(g.id, 42, 10, 10), CONTRIBUTION_FAIL_INVALID_CONDITION);
      assert.equal(mgr.canContribute(g.id, 1, 10, 10), CONTRIBUTION_OK);
    });

    it('FAIL_MAXLEVEL only when pxp > 0 -- pure penya to a level-50 guild is OK', () => {
      const g = mgr.create('Braves', 1)!;
      g.level = MAX_GUILD_LEVEL;
      assert.equal(mgr.canContribute(g.id, 1, 1, 0), CONTRIBUTION_FAIL_MAXLEVEL);
      assert.equal(
        mgr.canContribute(g.id, 1, 0, 5000), CONTRIBUTION_OK,
        'the max-level guard is PXP-only (guild.cpp:556) -- penya still funds the bank',
      );
    });

    it('FAIL_GUILD_OVERFLOW_PXP / _PENYA at the guild pool DWORD ceiling', () => {
      const g = mgr.create('Braves', 1)!;
      g.contributionPxp = MAX_DWORD - 10;
      assert.equal(mgr.canContribute(g.id, 1, 10, 0), CONTRIBUTION_OK, 'exactly the ceiling does not wrap');
      assert.equal(mgr.canContribute(g.id, 1, 11, 0), CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP);
      g.contributionPxp = 0;
      g.gold = MAX_DWORD - 10;
      assert.equal(mgr.canContribute(g.id, 1, 0, 10), CONTRIBUTION_OK);
      assert.equal(mgr.canContribute(g.id, 1, 0, 11), CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA);
    });

    it('FAIL_OVERFLOW_PXP at the member DWORD ceiling', () => {
      const g = mgr.create('Braves', 1)!;
      const m = mgr.getMember(g.id, 1)!;
      m.givePxp = MAX_DWORD - 10;
      assert.equal(mgr.canContribute(g.id, 1, 10, 0), CONTRIBUTION_OK);
      assert.equal(mgr.canContribute(g.id, 1, 11, 0), CONTRIBUTION_FAIL_OVERFLOW_PXP);
    });

    it('member penya trips at MAX_INT32 while the guild pool only trips at MAX_DWORD', () => {
      const g = mgr.create('Braves', 1)!;
      const m = mgr.getMember(g.id, 1)!;
      // m_nGiveGold is a signed int (guild.cpp:588 casts); m_nGoldGuild is a DWORD.
      m.giveGold = MAX_INT32 - 10;
      g.gold = 0;
      assert.equal(mgr.canContribute(g.id, 1, 0, 10), CONTRIBUTION_OK, 'exactly 2^31-1 is allowed');
      assert.equal(mgr.canContribute(g.id, 1, 0, 11), CONTRIBUTION_FAIL_OVERFLOW_PENYA);
      // The SAME donation is fine for the guild-side pool at that magnitude --
      // the two ceilings are genuinely different numbers.
      m.giveGold = 0;
      g.gold = MAX_INT32 - 10;
      assert.equal(mgr.canContribute(g.id, 1, 0, 11), CONTRIBUTION_OK);
      assert.notEqual(MAX_INT32, MAX_DWORD);
    });
  });

  describe('addContribution', () => {
    it('credits both the member counters and the guild pools', () => {
      const g = mgr.create('Braves', 1)!;
      const res = mgr.addContribution(g.id, 1, 7, 100);
      assert.ok(res);
      assert.equal(res!.leveled, false);
      assert.equal(res!.member.givePxp, 7);
      assert.equal(res!.member.giveGold, 100);
      assert.equal(g.contributionPxp, 7);
      assert.equal(g.gold, 100);
      const upd = harness.calls.filter((c) => c.method === 'update');
      assert.deepEqual(upd.at(-1)!.args, [g.id, { contribution_pxp: 7, gold: 100, level: 1 }]);
      const mem = harness.calls.filter((c) => c.method === 'updateMember');
      assert.deepEqual(mem.at(-1)!.args, [1, { give_pxp: 7, give_gold: 100 }]);
    });

    it('a level-up CONSUMES both pools, and the remainder carries', () => {
      const g = mgr.create('Braves', 1)!;
      const need = GUILD_TABLE[2];
      const exact = mgr.addContribution(g.id, 1, need.pxp, need.penya)!;
      assert.equal(exact.leveled, true);
      assert.equal(g.level, 2);
      assert.equal(g.contributionPxp, 0, 'pxp pool spent on the level-up');
      assert.equal(g.gold, 0, 'bank penya spent on the level-up too (-= dwMaxPenya)');
      // The member's lifetime counters are NOT reduced by the level-up.
      assert.equal(exact.member.givePxp, need.pxp);
      assert.equal(exact.member.giveGold, need.penya);

      const next = GUILD_TABLE[3];
      const over = mgr.addContribution(g.id, 1, next.pxp + 9, next.penya + 77)!;
      assert.equal(over.leveled, true);
      assert.equal(g.level, 3);
      assert.equal(g.contributionPxp, 9, 'leftover pxp carries');
      assert.equal(g.gold, 77, 'leftover penya carries');
    });

    it('is a single if, not a while -- three levels worth advances exactly one', () => {
      const g = mgr.create('Braves', 1)!;
      const pxp = GUILD_TABLE[2].pxp + GUILD_TABLE[3].pxp + GUILD_TABLE[4].pxp;
      const penya = GUILD_TABLE[2].penya + GUILD_TABLE[3].penya + GUILD_TABLE[4].penya;
      const res = mgr.addContribution(g.id, 1, pxp, penya)!;
      assert.equal(res.leveled, true);
      assert.equal(g.level, 2, 'one donation can never skip a level');
      assert.equal(g.contributionPxp, pxp - GUILD_TABLE[2].pxp);
      assert.equal(g.gold, penya - GUILD_TABLE[2].penya);
    });

    it('requires BOTH thresholds', () => {
      const need = GUILD_TABLE[2];
      const a = mgr.create('A', 1)!;
      assert.equal(mgr.addContribution(a.id, 1, need.pxp, need.penya - 1)!.leveled, false);
      assert.equal(a.level, 1, 'pxp met, penya short');
      assert.equal(a.contributionPxp, need.pxp, 'pools keep the donation');

      const b = mgr.create('B', 2)!;
      assert.equal(mgr.addContribution(b.id, 2, need.pxp - 1, need.penya)!.leveled, false);
      assert.equal(b.level, 1, 'penya met, pxp short');
      assert.equal(b.gold, need.penya);
    });

    it('never levels past MAX_GUILD_LEVEL', () => {
      const g = mgr.create('Braves', 1)!;
      g.level = MAX_GUILD_LEVEL;
      const res = mgr.addContribution(g.id, 1, 0, GUILD_TABLE[MAX_GUILD_LEVEL].penya * 2)!;
      assert.equal(res.leveled, false);
      assert.equal(g.level, MAX_GUILD_LEVEL);
      assert.equal(g.gold, GUILD_TABLE[MAX_GUILD_LEVEL].penya * 2, 'penya banked, nothing consumed');
    });

    it('returns null on a refusal and mutates nothing', () => {
      const g = mgr.create('Braves', 1)!;
      g.level = MAX_GUILD_LEVEL;
      g.contributionPxp = 5; g.gold = 6;
      const before = harness.calls.length;
      assert.equal(mgr.addContribution(g.id, 1, 1, 0), null, 'max level + pxp');
      assert.equal(mgr.addContribution(g.id, 42, 0, 1), null, 'non-member');
      assert.equal(mgr.addContribution(999, 1, 0, 1), null, 'unknown guild');
      assert.equal(g.contributionPxp, 5);
      assert.equal(g.gold, 6);
      assert.equal(mgr.getMember(g.id, 1)!.givePxp, 0);
      assert.equal(mgr.getMember(g.id, 1)!.giveGold, 0);
      assert.equal(harness.calls.length, before, 'and persists nothing');
    });
  });

  describe('decrementMemberContribution', () => {
    it('reverses ONLY the member counters -- pools and level stay put', () => {
      const g = mgr.create('Braves', 1)!;
      const need = GUILD_TABLE[2];
      mgr.addContribution(g.id, 1, need.pxp, need.penya);
      assert.equal(g.level, 2);
      mgr.decrementMemberContribution(g.id, 1, need.pxp, need.penya);
      const m = mgr.getMember(g.id, 1)!;
      assert.equal(m.givePxp, 0);
      assert.equal(m.giveGold, 0);
      assert.equal(g.level, 2, 'C++ does NOT un-level on a rollback');
      assert.equal(g.contributionPxp, 0);
      assert.equal(g.gold, 0);
    });

    it('is a no-op for a non-member', () => {
      const g = mgr.create('Braves', 1)!;
      const before = harness.calls.length;
      mgr.decrementMemberContribution(g.id, 42, 5, 5);
      mgr.decrementMemberContribution(999, 1, 5, 5);
      assert.equal(harness.calls.length, before);
    });
  });

  describe('paySalaries', () => {
    /** A guild with per-rank salaries and a funded bank. */
    function payroll(): { g: Guild } {
      const g = mgr.create('Braves', 1, [2, 3])!;
      mgr.setMemberLevel(g.id, 2, GUD_KINGPIN);
      g.penya[GUD_MASTER] = 100;
      g.penya[GUD_KINGPIN] = 50;
      g.penya[GUD_ROOKIE] = 10;
      g.gold = 1_000;
      return { g };
    }

    it('sums penya[rank] over the WHOLE roster, including offline members', () => {
      const { g } = payroll();
      // Member 3 is on the roster but has never been "online" here -- the sweep
      // iterates m_mapPMember, not the online set (guild.cpp:1089).
      const paid = mgr.paySalaries();
      assert.equal(paid.length, 1);
      assert.equal(paid[0].total, 160, '100 master + 50 kingpin + 10 offline rookie');
      assert.equal(g.gold, 840);
      assert.equal(mgr.getMember(g.id, 1)!.pay, 100);
      assert.equal(mgr.getMember(g.id, 2)!.pay, 50);
      assert.equal(mgr.getMember(g.id, 3)!.pay, 10, 'offline member still accrues');
      assert.equal(g.sentPay, true, 'm_bSendPay latched');
    });

    it('pays NOTHING when the payroll exceeds the bank (all-or-nothing)', () => {
      const { g } = payroll();
      g.gold = 159; // one short of the 160 payroll
      assert.deepEqual(mgr.paySalaries(), []);
      assert.equal(g.gold, 159, 'no partial payout');
      assert.equal(mgr.getMember(g.id, 1)!.pay, 0);
      assert.equal(g.sentPay, false, 'latch not set, so a later top-up can still pay');
      g.gold = 160;
      assert.equal(mgr.paySalaries()[0].total, 160, 'exactly affordable pays');
      assert.equal(g.gold, 0);
    });

    it('skips a guild whose payroll totals 0', () => {
      const g = mgr.create('Braves', 1, [2])!;
      g.gold = 5_000; // funded, but every salary is unset
      assert.deepEqual(mgr.paySalaries(), []);
      assert.equal(g.gold, 5_000);
      assert.equal(g.sentPay, false);
    });

    it('the latch makes a second call a no-op until resetSalaryLatch', () => {
      const { g } = payroll();
      assert.equal(mgr.paySalaries().length, 1);
      assert.equal(g.gold, 840);
      assert.deepEqual(mgr.paySalaries(), [], 'latched');
      assert.equal(g.gold, 840);
      assert.equal(mgr.getMember(g.id, 1)!.pay, 100, 'pay not doubled');
      mgr.resetSalaryLatch();
      assert.equal(g.sentPay, false);
      assert.equal(mgr.paySalaries().length, 1, 'pays again the next evening');
      assert.equal(g.gold, 680);
      assert.equal(mgr.getMember(g.id, 1)!.pay, 200, 'm_nPay accumulates');
    });

    it('grows each member pay by their OWN rank salary and persists gold once', () => {
      const { g } = payroll();
      const before = harness.calls.length;
      mgr.paySalaries();
      const after = harness.calls.slice(before);
      assert.deepEqual(
        after.filter((c) => c.method === 'update').map((c) => c.args),
        [[g.id, { gold: 840 }]],
      );
      assert.deepEqual(
        after.filter((c) => c.method === 'updateMember').map((c) => c.args),
        [[1, { pay: 100 }], [2, { pay: 50 }], [3, { pay: 10 }]],
      );
    });
  });
});
