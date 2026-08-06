/**
 * GuildService tests -- the permission ladder. Every guard here is a port of a
 * `CDPCacheSrvr::On*` refusal branch (`DPCacheSrvr.cpp:1185-1855`), so each case
 * asserts BOTH that nothing was sent and that the roster/state is untouched.
 * @module services/guild.service.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import {
  NULL_ID, GUD_MASTER, GUD_KINGPIN, GUD_CAPTAIN, GUD_SUPPORTER, GUD_ROOKIE,
  PF_INVITATION, PF_MEMBERLEVEL, PF_LEVEL,
  GUILD_ERROR_DUPLICATE_NAME, GUILD_ERROR_BAD_PENYA, MAX_GUILD_RANK_PENYA,
  CUSTOM_LOGO_MAX, GUILD_LOGO_GM_ONLY_ABOVE, MAX_MEMBER_LV_SIZE,
} from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { GuildService } from '../../src/services/guild.service';
import { GuildManager } from '../../src/managers/guild.manager';
import {
  GUILD_NICKNAME_MIN_LEVEL, GUILD_REJOIN_COOLDOWN_MS, guildMaxMembers,
} from '../../src/guildTable';

interface MockPlayer {
  m_idPlayer: number;
  m_szName: string;
  m_idGuild: number;
  m_nDuel: number;
  m_nZoneId: number;
  m_vPos: { x: number; y: number; z: number };
}

function makePlayer(id: number): MockPlayer & CPlayer {
  return {
    m_idPlayer: id, m_szName: `P${id}`, m_idGuild: NULL_ID, m_nDuel: 0,
    m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 },
  } as MockPlayer & CPlayer;
}

/** Leading DWORD of a direct packet -- the PACKETTYPE. */
function op(buf: Buffer): number { return buf.readUInt32LE(0); }
/** Subtype WORD of a snapshot record (prefix is 4+4+2+4 = 14 bytes). */
function subtype(buf: Buffer): number { return buf.readUInt16LE(14); }

function makeHarness() {
  const players = new Map<number, CPlayer>();
  const sent: Array<{ id: number; buf: Buffer }> = [];
  const broadcasts: Buffer[] = [];
  const around: Array<{ buf: Buffer; except: number | undefined }> = [];
  const playerManager = {
    get: (id: number) => players.get(id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
    broadcastAll: (buf: Buffer) => { broadcasts.push(buf); },
  };
  const zoneManager = {
    broadcastAround: (
      _pos: unknown, _zone: number, _radius: number, buf: Buffer, except?: CPlayer,
    ) => { around.push({ buf, except: except?.m_idPlayer }); },
  };
  return { players, sent, broadcasts, around, playerManager, zoneManager };
}

describe('GuildService', () => {
  let a: MockPlayer & CPlayer; // master in most cases
  let b: MockPlayer & CPlayer;
  let c: MockPlayer & CPlayer;
  let harness: ReturnType<typeof makeHarness>;
  let manager: GuildManager;
  let service: GuildService;
  let clock: number;
  let gmIds: Set<number>;

  beforeEach(() => {
    a = makePlayer(1); b = makePlayer(2); c = makePlayer(3);
    harness = makeHarness();
    harness.players.set(1, a); harness.players.set(2, b); harness.players.set(3, c);
    clock = 1_000_000;
    gmIds = new Set<number>();
    manager = new GuildManager(undefined, () => clock);
    service = new GuildService({
      playerManager: harness.playerManager as never,
      zoneManager: harness.zoneManager as never,
      guildManager: manager,
      isGameMaster: (p: CPlayer) => gmIds.has(p.m_idPlayer),
      now: () => clock,
    });
  });

  // The invite path arms a 30s setTimeout; drop any survivor so the runner is
  // not held open by a pending handle.
  afterEach(() => { for (const id of [1, 2, 3, 4]) manager.removePending(id); });

  function reset(): void { harness.sent.length = 0; harness.broadcasts.length = 0; harness.around.length = 0; }

  describe('create', () => {
    it('sets m_idGuild on every online member and announces CREATE_GUILD to all', () => {
      const g = service.create(a, 'Braves', [2, 3]);
      assert.ok(g);
      assert.equal(a.m_idGuild, g!.id);
      assert.equal(b.m_idGuild, g!.id);
      assert.equal(c.m_idGuild, g!.id);
      assert.equal(harness.broadcasts.length, 1);
      assert.equal(subtype(harness.broadcasts[0]), SNAPSHOTTYPE.CREATE_GUILD);
      // Each online member gets their own full GUILD snapshot.
      const guildSnaps = harness.sent.filter((s) => subtype(s.buf) === SNAPSHOTTYPE.GUILD);
      assert.deepEqual(guildSnaps.map((s) => s.id), [1, 2, 3]);
      // and peers around each one get SET_GUILD so the tag renders.
      assert.equal(harness.around.length, 3);
      assert.equal(subtype(harness.around[0].buf), SNAPSHOTTYPE.SET_GUILD);
    });

    it('skips offline founding members but still enrolls them', () => {
      harness.players.delete(3);
      const g = service.create(a, 'Braves', [2, 3])!;
      assert.ok(manager.getMember(g.id, 3), 'offline member is on the roster');
      assert.deepEqual(
        harness.sent.filter((s) => subtype(s.buf) === SNAPSHOTTYPE.GUILD).map((s) => s.id),
        [1, 2],
      );
    });

    it('refuses when the caller is already guilded', () => {
      service.create(a, 'Braves');
      reset();
      assert.equal(service.create(a, 'Second'), undefined);
      assert.equal(harness.sent.length, 0);
      assert.equal(harness.broadcasts.length, 0);
      assert.equal(manager.getByName('Second'), undefined);
    });

    it('refuses a duplicate name with GUILD_ERROR 1', () => {
      service.create(a, 'Braves');
      reset();
      assert.equal(service.create(b, 'braves'), undefined);
      assert.equal(harness.sent.length, 1);
      assert.equal(harness.sent[0].id, 2);
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.GUILD_ERROR);
      assert.equal(harness.sent[0].buf.readUInt32LE(4), GUILD_ERROR_DUPLICATE_NAME);
      assert.equal(b.m_idGuild, NULL_ID);
    });

    it('refuses an empty or over-long name', () => {
      assert.equal(service.create(a, '   '), undefined);
      assert.equal(service.create(a, 'x'.repeat(49)), undefined);
      assert.equal(harness.broadcasts.length, 0);
    });
  });

  describe('destroy', () => {
    it('refuses a non-master and leaves the guild standing', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.destroy(b);
      assert.ok(manager.get(g.id), 'guild survives');
      assert.equal(b.m_idGuild, g.id);
      assert.equal(harness.broadcasts.length, 0);
    });

    it('master disbands: every member cleared + DESTROY_GUILD to all', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      reset();
      service.destroy(a);
      assert.equal(manager.get(g.id), undefined);
      assert.equal(a.m_idGuild, NULL_ID);
      assert.equal(b.m_idGuild, NULL_ID);
      assert.equal(c.m_idGuild, NULL_ID);
      const removals = harness.sent.filter((s) => op(s.buf) === PACKETTYPE.REMOVE_GUILD_MEMBER);
      assert.deepEqual(removals.map((s) => s.id), [1, 2, 3]);
      assert.equal(harness.broadcasts.length, 1);
      assert.equal(subtype(harness.broadcasts[0]), SNAPSHOTTYPE.DESTROY_GUILD);
      for (const id of [1, 2, 3]) assert.equal(manager.onCooldown(id), true);
    });

    it('a guildless caller just gets a stale id cleared', () => {
      a.m_idGuild = 77;
      service.destroy(a);
      assert.equal(a.m_idGuild, NULL_ID);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('invite', () => {
    it('refuses without PF_INVITATION', () => {
      const g = service.create(a, 'Braves', [2])!;
      // B is a rookie: power[GUD_ROOKIE] is 0 on a fresh guild.
      assert.equal(manager.rankHasPower(g.id, GUD_ROOKIE, PF_INVITATION), false);
      reset();
      service.invite(b, 3);
      assert.equal(harness.sent.length, 0);
      assert.equal(manager.hasPending(3), false);
      // Granting the bit makes the same call succeed.
      manager.setAuthority(g.id, [0, 0, 0, 0, PF_INVITATION]);
      service.invite(b, 3);
      assert.equal(manager.hasPending(3), true);
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.SNAPSHOT);
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_INVITE);
    });

    it('master invite sends GUILD_INVITE to the target only', () => {
      service.create(a, 'Braves');
      reset();
      service.invite(a, 2);
      assert.equal(harness.sent.length, 1);
      assert.equal(harness.sent[0].id, 2);
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_INVITE);
      assert.equal(b.m_idGuild, NULL_ID, 'stale id zeroed before the dialog');
      assert.equal(manager.hasPending(2), true);
    });

    it('refuses a target already in a guild', () => {
      service.create(a, 'Braves');
      service.create(b, 'Heroes');
      reset();
      service.invite(a, 2);
      assert.equal(harness.sent.length, 0);
      assert.equal(manager.hasPending(2), false);
    });

    it('refuses a duelling target', () => {
      service.create(a, 'Braves');
      b.m_nDuel = 5;
      reset();
      service.invite(a, 2);
      assert.equal(harness.sent.length, 0);
      assert.equal(manager.hasPending(2), false);
    });

    it('refuses self, an offline target, and a non-member inviter', () => {
      service.create(a, 'Braves');
      reset();
      service.invite(a, 1);   // self
      service.invite(a, 999); // offline
      service.invite(c, 2);   // c has no guild
      assert.equal(harness.sent.length, 0);
    });

    it('refuses when the roster is full', () => {
      const g = service.create(a, 'Braves')!;
      const cap = guildMaxMembers(g.level);
      for (let id = 10; id < 10 + cap - 1; id++) manager.addMember(g.id, id);
      assert.equal(g.members.length, cap);
      reset();
      service.invite(a, 2);
      assert.equal(harness.sent.length, 0);
      assert.equal(manager.hasPending(2), false);
    });

    it('refuses a second invite while one is pending', () => {
      service.create(a, 'Braves');
      service.invite(a, 2);
      reset();
      service.invite(a, 2);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('accept', () => {
    it('joiner gets a full GUILD, existing members get ADD_GUILD_MEMBER', () => {
      const g = service.create(a, 'Braves', [3])!;
      service.invite(a, 2);
      reset();
      service.accept(b);
      assert.equal(b.m_idGuild, g.id);
      assert.ok(manager.getMember(g.id, 2), 'on the roster at rookie');
      assert.equal(manager.getMember(g.id, 2)!.memberLv, GUD_ROOKIE);

      const toJoiner = harness.sent.filter((s) => s.id === 2);
      const toExisting = harness.sent.filter((s) => s.id !== 2);
      assert.equal(toJoiner.length, 1);
      assert.equal(subtype(toJoiner[0].buf), SNAPSHOTTYPE.GUILD, 'full snapshot');
      assert.deepEqual(toExisting.map((s) => s.id), [1, 3]);
      for (const s of toExisting) {
        assert.equal(op(s.buf), PACKETTYPE.ADD_GUILD_MEMBER, 'incremental add');
      }
      // The asymmetry itself -- DPCacheSrvr.cpp:1341 branches on pPlayertmp == pPlayer.
      assert.notDeepEqual(toJoiner[0].buf, toExisting[0].buf);
      assert.equal(manager.hasPending(2), false, 'pending consumed');
    });

    it('refuses with no pending invite', () => {
      service.create(a, 'Braves');
      reset();
      service.accept(b);
      assert.equal(harness.sent.length, 0);
      assert.equal(b.m_idGuild, NULL_ID);
    });

    it('refuses while on the rejoin cooldown, and allows it once expired', () => {
      const g = service.create(a, 'Braves', [2])!;
      service.leaveOrKick(b, 2); // b leaves -> 2-day cooldown stamped
      assert.equal(manager.onCooldown(2), true);
      service.invite(a, 2);
      reset();
      service.accept(b);
      assert.equal(manager.getMember(g.id, 2), undefined, 'blocked by cooldown');
      assert.equal(harness.sent.length, 0);

      clock += GUILD_REJOIN_COOLDOWN_MS;
      service.invite(a, 2);
      reset();
      service.accept(b);
      assert.ok(manager.getMember(g.id, 2), 'joins once the lockout elapses');
    });

    it('refuses when the inviter went offline or the guild vanished', () => {
      const g = service.create(a, 'Braves')!;
      service.invite(a, 2);
      harness.players.delete(1);
      reset();
      service.accept(b);
      assert.equal(manager.getMember(g.id, 2), undefined, 'inviter offline');

      harness.players.set(1, a);
      service.invite(a, 2);
      manager.destroy(g.id);
      reset();
      service.accept(b);
      assert.equal(harness.sent.length, 0, 'guild gone');
    });

    it('decline clears the pending slot without joining', () => {
      const g = service.create(a, 'Braves')!;
      service.invite(a, 2);
      reset();
      service.decline(b);
      assert.equal(manager.hasPending(2), false);
      assert.equal(manager.getMember(g.id, 2), undefined);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('leaveOrKick', () => {
    it('a master may NOT leave', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.leaveOrKick(a, 1);
      assert.equal(g.members.length, 2, 'roster unchanged');
      assert.equal(a.m_idGuild, g.id);
      assert.equal(harness.sent.length, 0);
    });

    it('a non-master may leave', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.leaveOrKick(b, 2);
      assert.equal(manager.getMember(g.id, 2), undefined);
      assert.equal(b.m_idGuild, NULL_ID);
      assert.equal(manager.onCooldown(2), true);
      const removals = harness.sent.filter((s) => op(s.buf) === PACKETTYPE.REMOVE_GUILD_MEMBER);
      assert.deepEqual(removals.map((s) => s.id).sort(), [1, 2], 'leaver + remaining master told');
    });

    it('a non-master may NOT kick', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      reset();
      service.leaveOrKick(b, 3);
      assert.ok(manager.getMember(g.id, 3), 'target still a member');
      assert.equal(c.m_idGuild, g.id);
      assert.equal(harness.sent.length, 0);
    });

    it('a master may kick', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      reset();
      service.leaveOrKick(a, 3);
      assert.equal(manager.getMember(g.id, 3), undefined);
      assert.equal(c.m_idGuild, NULL_ID);
      assert.equal(manager.onCooldown(3), true);
    });

    it('kicking a non-member is a no-op', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.leaveOrKick(a, 999);
      assert.equal(g.members.length, 2);
      assert.equal(harness.sent.length, 0);
    });

    it('a guildless requester just gets a stale id cleared', () => {
      a.m_idGuild = 77;
      service.leaveOrKick(a, 1);
      assert.equal(a.m_idGuild, NULL_ID);
    });
  });

  describe('setMemberLevel', () => {
    it('refuses when the requester is not strictly more senior than the target', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      manager.setMemberLevel(g.id, 2, GUD_CAPTAIN);
      manager.setAuthority(g.id, [0, 0, PF_MEMBERLEVEL, 0, 0]);
      reset();
      // Equal rank (both captains) -> refused.
      manager.setMemberLevel(g.id, 3, GUD_CAPTAIN);
      service.setMemberLevel(b, 3, GUD_ROOKIE);
      assert.equal(manager.getMember(g.id, 3)!.memberLv, GUD_CAPTAIN);
      assert.equal(harness.sent.length, 0);
    });

    it('refuses when the NEW rank is not strictly below the requester', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      manager.setMemberLevel(g.id, 2, GUD_CAPTAIN);
      manager.setAuthority(g.id, [0, 0, PF_MEMBERLEVEL, 0, 0]);
      reset();
      // B (captain, 2) tries to promote a rookie to captain (2) -- 2 >= 2 refuses.
      service.setMemberLevel(b, 3, GUD_CAPTAIN);
      assert.equal(manager.getMember(g.id, 3)!.memberLv, GUD_ROOKIE);
      assert.equal(harness.sent.length, 0);
      // One step lower IS allowed.
      service.setMemberLevel(b, 3, GUD_SUPPORTER);
      assert.equal(manager.getMember(g.id, 3)!.memberLv, GUD_SUPPORTER);
    });

    it('refuses without PF_MEMBERLEVEL', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      manager.setMemberLevel(g.id, 2, GUD_KINGPIN);
      // Kingpin holds nothing on a fresh guild.
      reset();
      service.setMemberLevel(b, 3, GUD_CAPTAIN);
      assert.equal(manager.getMember(g.id, 3)!.memberLv, GUD_ROOKIE);
      assert.equal(harness.sent.length, 0);
      manager.setAuthority(g.id, [0, PF_MEMBERLEVEL, 0, 0, 0]);
      service.setMemberLevel(b, 3, GUD_CAPTAIN);
      assert.equal(manager.getMember(g.id, 3)!.memberLv, GUD_CAPTAIN);
    });

    it('refuses when the target rank headcount cap is full', () => {
      const g = service.create(a, 'Braves')!;
      const cap = MAX_MEMBER_LV_SIZE[GUD_KINGPIN];
      for (let i = 0; i < cap; i++) {
        manager.addMember(g.id, 100 + i);
        manager.setMemberLevel(g.id, 100 + i, GUD_KINGPIN);
      }
      manager.addMember(g.id, 2);
      assert.equal(manager.rankCount(g.id, GUD_KINGPIN), cap);
      reset();
      service.setMemberLevel(a, 2, GUD_KINGPIN);
      assert.equal(manager.getMember(g.id, 2)!.memberLv, GUD_ROOKIE, 'cap holds');
      assert.equal(harness.sent.length, 0);
    });

    it('master promotes and the whole online roster is told', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      reset();
      service.setMemberLevel(a, 2, GUD_CAPTAIN);
      assert.equal(manager.getMember(g.id, 2)!.memberLv, GUD_CAPTAIN);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2, 3]);
      for (const s of harness.sent) assert.equal(op(s.buf), PACKETTYPE.GUILD_MEMBER_LEVEL);
    });

    it('refuses an out-of-range rank and a non-member target', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.setMemberLevel(a, 2, 99);
      service.setMemberLevel(a, 999, GUD_CAPTAIN);
      assert.equal(manager.getMember(g.id, 2)!.memberLv, GUD_ROOKIE);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('setMemberClass', () => {
    it('refuses without PF_LEVEL', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      manager.setMemberLevel(g.id, 2, GUD_KINGPIN);
      reset();
      service.setMemberClass(b, 3, true);
      assert.equal(manager.getMember(g.id, 3)!.memberClass, 0);
      assert.equal(harness.sent.length, 0);
      manager.setAuthority(g.id, [0, PF_LEVEL, 0, 0, 0]);
      service.setMemberClass(b, 3, true);
      assert.equal(manager.getMember(g.id, 3)!.memberClass, 1);
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.GUILD_CLASS);
    });

    it('clamps at 0 (down is a no-op) and 2 (up is a no-op)', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.setMemberClass(a, 2, false);
      assert.equal(manager.getMember(g.id, 2)!.memberClass, 0, 'no negative class');
      assert.equal(harness.sent.length, 0);
      service.setMemberClass(a, 2, true);
      service.setMemberClass(a, 2, true);
      assert.equal(manager.getMember(g.id, 2)!.memberClass, 2);
      reset();
      service.setMemberClass(a, 2, true);
      assert.equal(manager.getMember(g.id, 2)!.memberClass, 2, 'capped at 2');
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('setMemberAlias', () => {
    it('refuses below guild level 10', () => {
      const g = service.create(a, 'Braves', [2])!;
      assert.equal(g.level, 1);
      reset();
      service.setMemberAlias(a, 2, 'Scout');
      assert.equal(manager.getMember(g.id, 2)!.alias, '');
      assert.equal(harness.sent.length, 0);
      g.level = GUILD_NICKNAME_MIN_LEVEL;
      service.setMemberAlias(a, 2, 'Scout');
      assert.equal(manager.getMember(g.id, 2)!.alias, 'Scout');
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.GUILD_NICKNAME);
    });

    it('refuses length < 2 or > 12', () => {
      const g = service.create(a, 'Braves', [2])!;
      g.level = GUILD_NICKNAME_MIN_LEVEL;
      reset();
      service.setMemberAlias(a, 2, 'x');
      service.setMemberAlias(a, 2, 'x'.repeat(13));
      service.setMemberAlias(a, 2, '  ');
      assert.equal(manager.getMember(g.id, 2)!.alias, '');
      assert.equal(harness.sent.length, 0);
      service.setMemberAlias(a, 2, 'x'.repeat(12));
      assert.equal(manager.getMember(g.id, 2)!.alias.length, 12, 'the bound itself is allowed');
    });

    it('is master only', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      g.level = GUILD_NICKNAME_MIN_LEVEL;
      manager.setAuthority(g.id, [0, 0, 0, 0, 0xff]); // no power grants this
      reset();
      service.setMemberAlias(b, 3, 'Scout');
      assert.equal(manager.getMember(g.id, 3)!.alias, '');
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('changeMaster', () => {
    it('is master only, requires a member target, and self is a no-op', () => {
      const g = service.create(a, 'Braves', [2, 3])!;
      reset();
      service.changeMaster(b, 3);      // b is not the master
      assert.equal(g.masterId, 1);
      service.changeMaster(a, 999);    // not a member
      assert.equal(g.masterId, 1);
      service.changeMaster(a, 1);      // self
      assert.equal(g.masterId, 1);
      assert.equal(harness.sent.length, 0);
    });

    it('transfers and tells the roster', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.changeMaster(a, 2);
      assert.equal(g.masterId, 2);
      assert.equal(manager.getMember(g.id, 1)!.memberLv, GUD_ROOKIE);
      assert.equal(manager.getMember(g.id, 2)!.memberLv, GUD_MASTER);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      for (const s of harness.sent) assert.equal(op(s.buf), PACKETTYPE.CHG_MASTER);
    });
  });

  describe('setRankPenya', () => {
    it('sends GUILD_ERROR 2 for >= 1000000 and for negative', () => {
      const g = service.create(a, 'Braves')!;
      reset();
      service.setRankPenya(a, GUD_ROOKIE, MAX_GUILD_RANK_PENYA);
      service.setRankPenya(a, GUD_ROOKIE, -1);
      assert.equal(g.penya[GUD_ROOKIE], 0);
      assert.equal(harness.sent.length, 2);
      for (const s of harness.sent) {
        assert.equal(op(s.buf), PACKETTYPE.GUILD_ERROR);
        assert.equal(s.buf.readUInt32LE(4), GUILD_ERROR_BAD_PENYA);
      }
    });

    it('is master only, and accepts the top legal value', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.setRankPenya(b, GUD_ROOKIE, 500);
      assert.equal(g.penya[GUD_ROOKIE], 0, 'non-master refused');
      assert.equal(harness.sent.length, 0);
      service.setRankPenya(a, GUD_ROOKIE, MAX_GUILD_RANK_PENYA - 1);
      assert.equal(g.penya[GUD_ROOKIE], MAX_GUILD_RANK_PENYA - 1);
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.SNAPSHOT);
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_PENYA);
    });

    it('refuses an out-of-range rank without an error packet', () => {
      service.create(a, 'Braves');
      reset();
      service.setRankPenya(a, 99, 100);
      service.setRankPenya(a, -1, 100);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('setLogo', () => {
    it('rejects > CUSTOM_LOGO_MAX outright', () => {
      const g = service.create(a, 'Braves')!;
      gmIds.add(1);
      reset();
      service.setLogo(a, CUSTOM_LOGO_MAX + 1);
      assert.equal(g.logo, 0);
      assert.equal(harness.broadcasts.length, 0);
    });

    it('rejects > 20 for a normal player, accepts it for a GM', () => {
      const g = service.create(a, 'Braves')!;
      reset();
      service.setLogo(a, GUILD_LOGO_GM_ONLY_ABOVE + 1);
      assert.equal(g.logo, 0, 'needs AUTH_GAMEMASTER');
      assert.equal(harness.broadcasts.length, 0);
      gmIds.add(1);
      service.setLogo(a, GUILD_LOGO_GM_ONLY_ABOVE + 1);
      assert.equal(g.logo, GUILD_LOGO_GM_ONLY_ABOVE + 1);
      assert.equal(harness.broadcasts.length, 1);
      assert.equal(subtype(harness.broadcasts[0]), SNAPSHOTTYPE.GUILD_LOGO);
    });

    it('a normal player may set <= 20, and the write is once-only', () => {
      const g = service.create(a, 'Braves')!;
      reset();
      service.setLogo(a, GUILD_LOGO_GM_ONLY_ABOVE);
      assert.equal(g.logo, GUILD_LOGO_GM_ONLY_ABOVE);
      assert.equal(harness.broadcasts.length, 1);
      service.setLogo(a, 3);
      assert.equal(g.logo, GUILD_LOGO_GM_ONLY_ABOVE, 'second write refused');
      assert.equal(harness.broadcasts.length, 1, 'and not announced');
    });
  });

  describe('rename', () => {
    it('is master only', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.rename(b, 'Heroes');
      assert.equal(g.name, 'Braves');
      assert.equal(harness.broadcasts.length, 0);
    });

    it('a duplicate sends GUILD_ERROR 1 and keeps the old name', () => {
      const g = service.create(a, 'Braves')!;
      service.create(b, 'Heroes');
      reset();
      service.rename(a, 'heroes');
      assert.equal(g.name, 'Braves');
      assert.equal(harness.sent.length, 1);
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.GUILD_ERROR);
      assert.equal(harness.sent[0].buf.readUInt32LE(4), GUILD_ERROR_DUPLICATE_NAME);
      assert.equal(harness.broadcasts.length, 0);
    });

    it('master rename announces GUILD_SETNAME to all', () => {
      const g = service.create(a, 'Braves')!;
      reset();
      service.rename(a, 'Heroes');
      assert.equal(g.name, 'Heroes');
      assert.equal(harness.broadcasts.length, 1);
      assert.equal(op(harness.broadcasts[0]), PACKETTYPE.GUILD_SETNAME);
    });
  });

  describe('setNotice + chat', () => {
    it('setNotice drops an empty string and clips to MAX_BYTE_NOTICE-1', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.setNotice(a, '');
      assert.equal(g.notice, '');
      assert.equal(harness.sent.length, 0);
      service.setNotice(a, 'x'.repeat(200));
      assert.equal(g.notice.length, 127);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_NOTICE);
    });

    it('chat fans out to every online member, nothing when guildless', () => {
      service.create(a, 'Braves', [2, 3]);
      harness.players.delete(3);
      reset();
      service.chat(a, 'hi');
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      for (const s of harness.sent) assert.equal(op(s.buf), PACKETTYPE.GUILD_CHAT);
      reset();
      service.chat(makePlayer(9), 'hi');
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('setAuthority', () => {
    it('is master only and echoes the forced mask to the roster', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.setAuthority(b, [0, 0xff, 0, 0, 0]);
      assert.deepEqual(g.power.slice(1), [0, 0, 0, 0], 'non-master refused');
      assert.equal(harness.sent.length, 0);
      service.setAuthority(a, [0, PF_INVITATION, 0, 0, 0]);
      assert.equal(g.power[GUD_MASTER], 0xff, 'master mask re-forced');
      assert.equal(g.power[GUD_KINGPIN], PF_INVITATION);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_AUTHORITY);
    });
  });

  describe('onJoin / onDisconnect', () => {
    it('sends ALL_GUILDS even to a guildless player and clears a stale id', () => {
      service.create(a, 'Braves');
      c.m_idGuild = 77;
      reset();
      assert.equal(service.onJoin(c), false);
      assert.equal(c.m_idGuild, NULL_ID, 'stale id cleared');
      assert.equal(harness.sent.length, 1, 'the peer guild-tag cache is still seeded');
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.ALL_GUILDS);
    });

    it('a guilded player also gets GUILD + GUILD_GAMEJOIN', () => {
      const g = service.create(a, 'Braves', [2])!;
      a.m_idGuild = NULL_ID; // fresh CPlayer from JoinService
      reset();
      assert.equal(service.onJoin(a), true);
      assert.equal(a.m_idGuild, g.id);
      const toSelf = harness.sent.filter((s) => s.id === 1);
      assert.equal(subtype(toSelf[0].buf), SNAPSHOTTYPE.ALL_GUILDS, 'ALL_GUILDS first');
      assert.equal(subtype(toSelf[1].buf), SNAPSHOTTYPE.GUILD);
      assert.equal(op(toSelf[2].buf), PACKETTYPE.GUILD_GAMEJOIN);
      // Online mates get the "came online" notice.
      const toMate = harness.sent.filter((s) => s.id === 2);
      assert.equal(toMate.length, 1);
      assert.equal(op(toMate[0].buf), PACKETTYPE.GUILD_GAMELOGIN);
      assert.equal(toMate[0].buf.readUInt8(4), 1, 'nLogin = 1');
    });

    it('onDisconnect keeps the roster and sends GUILD_GAMELOGIN 0 to mates', () => {
      const g = service.create(a, 'Braves', [2])!;
      reset();
      service.onDisconnect(a);
      assert.equal(g.members.length, 2, 'offline members stay on the roster');
      assert.deepEqual(harness.sent.map((s) => s.id), [2]);
      assert.equal(op(harness.sent[0].buf), PACKETTYPE.GUILD_GAMELOGIN);
      assert.equal(harness.sent[0].buf.readUInt8(4), 0, 'nLogin = 0');
    });

    it('onDisconnect on a guildless player sends nothing', () => {
      reset();
      service.onDisconnect(c);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('script predicates', () => {
    it('isGuild / isGuildMaster / guildSize', () => {
      assert.equal(service.isGuild(1), 0);
      const g = service.create(a, 'Braves', [2])!;
      assert.equal(service.isGuild(1), 1);
      assert.equal(service.isGuildMaster(1), 1);
      assert.equal(service.isGuildMaster(2), 0);
      assert.equal(service.guildSize(1), 2);
      assert.equal(service.guildSize(99), 0);
      assert.equal(g.id > 0, true);
    });

    it('isPartyGuild is INVERTED -- 0 only when everyone is eligible', () => {
      assert.equal(service.isPartyGuild([]), 1, 'no party');
      assert.equal(service.isPartyGuild([1, 2, 999]), 1, 'a member is offline');
      assert.equal(service.isPartyGuild([1, 2, 3]), 0, 'all eligible');
      service.create(c, 'Heroes');
      assert.equal(service.isPartyGuild([1, 2, 3]), 1, 'a member is already guilded');
      service.leaveOrKick(c, 3); // master cannot leave -> disband instead
      service.destroy(c);
      assert.equal(manager.getByMember(3), undefined);
      assert.equal(service.isPartyGuild([1, 2, 3]), 2, 'a member is on the rejoin cooldown');
      clock += GUILD_REJOIN_COOLDOWN_MS;
      assert.equal(service.isPartyGuild([1, 2, 3]), 0, 'eligible again once it expires');
    });
  });
});
