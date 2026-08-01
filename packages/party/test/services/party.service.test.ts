/**
 * PartyService tests -- invite guards, accept roster broadcast, decline, leave/
 * kick, leader auto-promote, disband, chat member-loop, distributeExp (proximity
 * + level gate + split sum), onDisconnect.
 * @module services/party.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PartyService } from '../../src/services/party.service';
import { PartyManager } from '../../src/managers/party.manager';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

interface MockPlayer {
  m_idPlayer: number;
  m_szName: string;
  m_nLevel: number;
  m_nJob: number;
  m_nSex: number;
  m_idParty: number;
  m_nZoneId: number;
  m_vPos: { x: number; y: number; z: number };
}

function makePlayer(id: number, level = 10): MockPlayer & CPlayer {
  return {
    m_idPlayer: id, m_szName: `P${id}`, m_nLevel: level, m_nJob: 0, m_nSex: 0,
    m_idParty: NULL_ID, m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 },
  } as MockPlayer & CPlayer;
}

/** Subtype WORD at offset 14 of a self-snapshot frame. */
function subtype(buf: Buffer): number { return buf.readUInt16LE(14); }

function makeHarness() {
  const players = new Map<number, CPlayer>();
  const sent: Array<{ id: number; buf: Buffer }> = [];
  const pm = {
    get: (id: number) => players.get(id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
  };
  const grants: Array<{ id: number; amount: number }> = [];
  const grantExpAmount = (p: CPlayer, amount: number) => grants.push({ id: p.m_idPlayer, amount });
  return { players, pm, sent, grants, grantExpAmount };
}

describe('PartyService', () => {
  let a: MockPlayer & CPlayer;
  let b: MockPlayer & CPlayer;
  let c: MockPlayer & CPlayer;
  let harness: ReturnType<typeof makeHarness>;
  let manager: PartyManager;
  let service: PartyService;

  beforeEach(() => {
    a = makePlayer(1); b = makePlayer(2); c = makePlayer(3);
    harness = makeHarness();
    harness.players.set(1, a); harness.players.set(2, b); harness.players.set(3, c);
    manager = new PartyManager();
    service = new PartyService({
      playerManager: harness.pm as never, partyManager: manager, grantExpAmount: harness.grantExpAmount,
    });
  });

  it('invite sends PARTYREQEST popup to target only', () => {
    service.invite(a, 2);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].id, 2);
    assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.PARTYREQEST);
    assert.ok(manager.hasPending(2));
  });

  it('invite refuses self / full / target-in-party / target-not-found', () => {
    service.invite(a, 1);
    assert.equal(harness.sent.length, 0, 'self blocked');
    service.invite(a, 999);
    assert.equal(harness.sent.length, 0, 'target not found');
    service.invite(a, 2);
    assert.equal(harness.sent.length, 1);
    harness.sent.length = 0;
    // Target already in a party -- blocker.
    manager.create(2, 3);
    service.invite(a, 2);
    assert.equal(harness.sent.length, 0);
  });

  it('accept creates party + broadcasts PARTYMEMBER roster to all members', () => {
    service.invite(a, 2);
    harness.sent.length = 0;
    service.accept(b, 1);
    assert.equal(a.m_idParty, b.m_idParty, 'both share party id');
    assert.notEqual(a.m_idParty, NULL_ID);
    const partyIds = harness.sent.map((s) => s.id).sort();
    assert.deepEqual(partyIds, [1, 2], 'roster sent to both members');
    assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.PARTYMEMBER);
    assert.ok(!manager.hasPending(2), 'pending cleared');
  });

  it('decline clears pending + sends PARTYREQESTCANCEL to leader', () => {
    service.invite(a, 2);
    harness.sent.length = 0;
    service.decline(b);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].id, 1);
    assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.PARTYREQESTCANCEL);
    assert.ok(!manager.hasPending(2));
  });

  it('kick (leader-only) removes a member + re-broadcasts roster', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.leaveOrKick(a, 2);
    assert.equal(b.m_idParty, NULL_ID, 'kicked member party cleared');
    const rostered = harness.sent.some((s) => subtype(s.buf) === SNAPSHOTTYPE.PARTYMEMBER);
    assert.ok(rostered, 'roster rebroadcast');
    // Single-member party disbanded.
    assert.equal(manager.getByMember(1), undefined);
  });

  it('non-member kick is rejected (leader-only)', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.leaveOrKick(b, 1);
    // b is not the leader so cannot kick a.
    assert.equal(a.m_idParty !== NULL_ID, true, 'a still in party');
  });

  it('leader-leave auto-promotes member[0] and broadcasts ADDPARTYCHANGELEADER', () => {
    service.invite(a, 2); service.accept(b, 1);
    service.invite(a, 3); service.accept(c, 1);
    harness.sent.length = 0;
    service.leaveOrKick(a, 1);
    assert.equal(a.m_idParty, NULL_ID);
    const leaderNotice = harness.sent.some((s) => subtype(s.buf) === SNAPSHOTTYPE.ADDPARTYCHANGELEADER);
    assert.ok(leaderNotice, 'leader-change notice broadcast');
    const remaining = manager.getByMember(2);
    assert.ok(remaining, 'party persists with 2 members');
    assert.equal(remaining!.members[0], 2, 'b is new leader');
  });

  it('chat fans out PARTYCHAT to every member', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.chat(a, 'hi');
    assert.equal(harness.sent.length, 2);
    for (const s of harness.sent) assert.equal(subtype(s.buf), SNAPSHOTTYPE.PARTYCHAT);
  });

  it('changeExpMode / changeItemMode are leader-only', () => {
    service.invite(a, 2); service.accept(b, 1);
    service.changeExpMode(b, 1);
    const party = manager.getByMember(1)!;
    assert.equal(party.expMode, 0, 'non-leader change rejected');
    service.changeExpMode(a, 1);
    assert.equal(party.expMode, 1, 'leader change applied');
    service.changeItemMode(b, 1);
    assert.equal(party.itemMode, 0, 'non-leader change rejected');
    service.changeItemMode(a, 1);
    assert.equal(party.itemMode, 1, 'leader change applied');
  });

  describe('distributeExp', () => {
    it('returns null when killer has no party', () => {
      const mover = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 } } as never;
      assert.equal(service.distributeExp(a, mover, 100), null);
    });

    it('proximity gate excludes far member; level gate excludes low member; split sums', () => {
      // Party of 3: A=10 (killer), B=10 (near), C=10 (far, 100m away).
      a.m_nLevel = 10; b.m_nLevel = 10; c.m_nLevel = 10;
      c.m_vPos = { x: 100, y: 0, z: 0 };
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      harness.grants.length = 0;
      const mover = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 } } as never;
      const n = service.distributeExp(a, mover, 100);
      assert.equal(n, 2, 'only A + B (near) granted');
      const grantedIds = harness.grants.map((g) => g.id).sort();
      assert.deepEqual(grantedIds, [1, 2]);
      // bonus = 100*0.2*(2-1) = 20; total = 120; split 50/50 -> 60 each.
      assert.deepEqual(harness.grants.map((g) => g.amount), [60, 60]);
    });

    it('level gate drops member below maxLv-20', () => {
      a.m_nLevel = 50; b.m_nLevel = 50; c.m_nLevel = 25; // 50-20=30; C(25) excluded
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      harness.grants.length = 0;
      const mover = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 } } as never;
      const n = service.distributeExp(a, mover, 100);
      assert.equal(n, 2, 'C excluded by level gate');
      assert.deepEqual(harness.grants.map((g) => g.id).sort(), [1, 2]);
    });

    it('different zones excluded by proximity', () => {
      a.m_nLevel = 10; b.m_nLevel = 10; b.m_nZoneId = 2;
      service.invite(a, 2); service.accept(b, 1);
      harness.grants.length = 0;
      const mover = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 } } as never;
      const n = service.distributeExp(a, mover, 100);
      assert.equal(n, 1, 'only A (same zone) granted');
      assert.deepEqual(harness.grants.map((g) => g.id), [1]);
    });
  });

  describe('onDisconnect', () => {
    it('leader disconnect auto-promotes + rebroadcasts (party persists with >=2)', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      harness.sent.length = 0;
      service.onDisconnect(a);
      assert.equal(a.m_idParty, NULL_ID);
      const remaining = manager.getByMember(2);
      assert.ok(remaining, 'party persists');
      assert.equal(remaining!.members[0], 2, 'b promoted');
      const leaderNotice = harness.sent.some((s) => subtype(s.buf) === SNAPSHOTTYPE.ADDPARTYCHANGELEADER);
      assert.ok(leaderNotice);
    });

    it('disband when last-but-one disconnects', () => {
      service.invite(a, 2); service.accept(b, 1);
      harness.sent.length = 0;
      service.onDisconnect(a);
      assert.equal(b.m_idParty, NULL_ID, 'remaining member cleared');
      assert.equal(manager.getByMember(2), undefined, 'party gone');
      const disbanded = harness.sent.some((s) => subtype(s.buf) === SNAPSHOTTYPE.PARTYMEMBER);
      assert.ok(disbanded);
    });
  });

  describe('naviPoint (map ping)', () => {
    const pos = { x: 100, y: 0, z: 200 };

    it('NULL_ID target fans out to every party member', () => {
      service.invite(a, 2); service.accept(b, 1);
      harness.sent.length = 0;
      service.naviPoint(a, pos, NULL_ID);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.SETNAVIPOINT);
      // Record objid is the PINGER in every copy, not the recipient.
      assert.equal(harness.sent[1].buf.readUInt32LE(10), 1);
    });

    it('NULL_ID target with no party sends nothing', () => {
      service.naviPoint(a, pos, NULL_ID);
      assert.equal(harness.sent.length, 0);
    });

    it('focused target pings both pinger and target, party or not', () => {
      service.naviPoint(a, pos, 3);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 3]);
    });

    it('focused self pings once', () => {
      service.naviPoint(a, pos, 1);
      assert.deepEqual(harness.sent.map((s) => s.id), [1]);
    });

    it('offline focused target sends nothing', () => {
      service.naviPoint(a, pos, 999);
      assert.equal(harness.sent.length, 0);
    });
  });
});
