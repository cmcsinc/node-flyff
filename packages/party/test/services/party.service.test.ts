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
import { MAX_PARTY_LEVEL } from '../../src/managers/party.manager';
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

  it('kicked member gets an empty PARTYMEMBER teardown addressed to themself', () => {
    service.invite(a, 2); service.accept(b, 1);
    service.invite(a, 3); service.accept(c, 1);
    harness.sent.length = 0;
    service.leaveOrKick(a, 3); // leader kicks c; party of 2 survives
    const toC = harness.sent.filter((s) => s.id === 3);
    assert.equal(toC.length, 1, 'removed player notified exactly once');
    assert.equal(subtype(toC[0].buf), SNAPSHOTTYPE.PARTYMEMBER);
    // nSizeofMember == 0 -> teardown. idPlayer (offset 16) must be the removed
    // player so the client says "you left" and not "party disbanded".
    assert.equal(toC[0].buf.readUInt32LE(16), 3);
    assert.equal(toC[0].buf.readUInt32LE(toC[0].buf.length - 4), 0, 'size 0');
    // Survivors got a real roster (size 2), not a teardown.
    for (const s of harness.sent.filter((x) => x.id !== 3)) {
      assert.equal(subtype(s.buf), SNAPSHOTTYPE.PARTYMEMBER);
      assert.equal(s.buf.readUInt32LE(16), 3, 'affected id = the departed member');
    }
  });

  it('disband teardown uses idPlayer 0 for survivors, self-id for the leaver', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.leaveOrKick(b, 2); // b leaves -> party of 1 -> disband
    const toB = harness.sent.filter((s) => s.id === 2);
    const toA = harness.sent.filter((s) => s.id === 1);
    assert.equal(toB.length, 1);
    assert.equal(toB[0].buf.readUInt32LE(16), 2, 'leaver sees own id -> "you left"');
    assert.equal(toA.length, 1);
    assert.equal(toA[0].buf.readUInt32LE(16), 0, 'survivor sees 0 -> "disbanded"');
    assert.equal(a.m_idParty, NULL_ID);
    assert.equal(b.m_idParty, NULL_ID);
  });

  it('changeLeader promotes + sends ONLY the leader notice (no roster resend)', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.changeLeader(a, 2);
    assert.equal(manager.getByMember(1)!.members[0], 2, 'b promoted to slot 0');
    assert.equal(harness.sent.length, 2, 'one notice per member');
    for (const s of harness.sent) {
      assert.equal(subtype(s.buf), SNAPSHOTTYPE.ADDPARTYCHANGELEADER);
      assert.equal(s.buf.readUInt32LE(16), 2, 'new leader id');
    }
  });

  it('changeLeader rejects non-leader requester, self, and non-members', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.changeLeader(b, 1);   // b is not the leader
    service.changeLeader(a, 1);   // a is already the leader
    service.changeLeader(a, 999); // not a member (C++ would memcpy OOB)
    assert.equal(harness.sent.length, 0);
    assert.equal(manager.getByMember(1)!.members[0], 1, 'leader unchanged');
  });

  describe('changeTroup (advance party)', () => {
    it('leader advances the party and every member gets PARTYCHANGETROUP', () => {
      service.invite(a, 2); service.accept(b, 1);
      harness.sent.length = 0;
      service.changeTroup(a, 'Braves');
      const party = manager.getByMember(1)!;
      assert.equal(party.kindTroup, 1);
      assert.equal(party.name, 'Braves');
      assert.equal(harness.sent.length, 2);
      for (const s of harness.sent) assert.equal(subtype(s.buf), SNAPSHOTTYPE.PARTYCHANGETROUP);
    });

    it('rejects non-leader, empty/over-long names, and a second advance', () => {
      service.invite(a, 2); service.accept(b, 1);
      const party = manager.getByMember(1)!;
      harness.sent.length = 0;
      service.changeTroup(b, 'Nope');            // not leader
      service.changeTroup(a, '   ');             // empty after trim
      service.changeTroup(a, 'x'.repeat(33));    // over MAX_PARTY_NAME_LEN
      assert.equal(party.kindTroup, 0);
      assert.equal(harness.sent.length, 0);
      service.changeTroup(a, 'Braves');
      harness.sent.length = 0;
      service.changeTroup(a, 'Renamed');         // already a troupe -- one-way
      assert.equal(party.name, 'Braves');
      assert.equal(harness.sent.length, 0);
    });

    it('later roster broadcasts keep kindTroup + name (no silent demotion)', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.changeTroup(a, 'Braves');
      service.invite(a, 3);
      harness.sent.length = 0;
      service.accept(c, 1);
      const roster = harness.sent.find((s) => subtype(s.buf) === SNAPSHOTTYPE.PARTYMEMBER);
      assert.ok(roster, 'roster broadcast on join');
      // kindTroup is the 2nd DWORD of CParty::Serialize. Body: prefix(16) +
      // idPlayer(4) + 2 strings + nSizeofMember(4) then partyId, kindTroup.
      const buf = roster!.buf;
      let off = 20;
      off += 4 + buf.readUInt32LE(off);  // leader name
      off += 4 + buf.readUInt32LE(off);  // member name
      off += 4;                          // nSizeofMember
      off += 4;                          // m_uPartyId
      assert.equal(buf.readUInt32LE(off), 1, 'kindTroup still 1');
      assert.ok(buf.includes(Buffer.from('Braves', 'utf8')), 'm_sParty present');
    });
  });

  it('chat fans out PARTYCHAT to every member', () => {
    service.invite(a, 2); service.accept(b, 1);
    harness.sent.length = 0;
    service.chat(a, 'hi');
    assert.equal(harness.sent.length, 2);
    for (const s of harness.sent) assert.equal(subtype(s.buf), SNAPSHOTTYPE.PARTYCHAT);
  });

  it('changeExpMode / changeItemMode are leader-only + echo the mode snapshot', () => {
    service.invite(a, 2); service.accept(b, 1);
    service.changeExpMode(b, 1);
    const party = manager.getByMember(1)!;
    assert.equal(party.expMode, 0, 'non-leader change rejected');
    harness.sent.length = 0;
    service.changeExpMode(a, 1);
    assert.equal(party.expMode, 1, 'leader change applied');
    assert.equal(harness.sent.length, 2, 'echoed to both members');
    for (const s of harness.sent) {
      assert.equal(subtype(s.buf), SNAPSHOTTYPE.PARTYCHANGEEXPMODE);
    }
    service.changeItemMode(b, 1);
    assert.equal(party.itemMode, 0, 'non-leader change rejected');
    harness.sent.length = 0;
    service.changeItemMode(a, 1);
    assert.equal(party.itemMode, 1, 'leader change applied');
    assert.equal(harness.sent.length, 2);
    for (const s of harness.sent) {
      assert.equal(subtype(s.buf), SNAPSHOTTYPE.PARTYCHANGEITEMMODE);
    }
  });

  it('rejects out-of-range share modes', () => {
    service.invite(a, 2); service.accept(b, 1);
    const party = manager.getByMember(1)!;
    service.changeItemMode(a, 4);  // > PARTY_ITEM_MODE_MAX (3)
    assert.equal(party.itemMode, 0, 'mode 4 rejected');
    service.changeItemMode(a, -1);
    assert.equal(party.itemMode, 0, 'negative rejected');
    service.changeExpMode(a, 2);   // only 0/1 exist
    assert.equal(party.expMode, 0, 'exp mode 2 rejected');
  });

  describe('distributeExp', () => {
    /** Mover stub -- level drives `expPartyReduceFactor`, pos/zone the scan. */
    const mob = (level: number, pos = { x: 0, y: 0, z: 0 }, zone = 1) =>
      ({ m_nZoneId: zone, m_nLevel: level, m_vPos: pos }) as never;

    it('returns null when killer has no party', () => {
      assert.equal(service.distributeExp(a, mob(10), 100), null);
    });

    it('returns null when only one member is nearby (C++ falls back to solo)', () => {
      c.m_vPos = { x: 100, y: 0, z: 0 };
      service.invite(a, 3); service.accept(c, 1);
      assert.equal(
        service.distributeExp(a, mob(10), 100), null,
        'nMemberSize <= 1 -> AddExperienceSolo(bParty=TRUE)',
      );
    });

    it('splits by level^2 with the member-count bonus', () => {
      // A=10 (killer), B=10 near, C=10 100m away -> nearby = {A,B}.
      a.m_nLevel = 10; b.m_nLevel = 10; c.m_nLevel = 10;
      c.m_vPos = { x: 100, y: 0, z: 0 };
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      harness.grants.length = 0;
      const n = service.distributeExp(a, mob(10), 100);
      assert.equal(n, 2, 'only A + B (near) granted');
      assert.deepEqual(harness.grants.map((g) => g.id).sort(), [1, 2]);
      // factor 1.0 (mover lv == maxLv); addExp = 100*0.2*(2-1) = 20;
      // total 120 split 50/50 -> 60 each (under level-10 nLimitExp 69).
      assert.deepEqual(harness.grants.map((g) => g.amount), [60, 60]);
    });

    it('an out-of-band member still dilutes the split (C++ denominator)', () => {
      // maxLv 50 -> nMaxLevel10 = 30, so C(25) is paid nothing -- but its lv^2
      // IS in fMaxMemberLevel and it DOES count toward fAddExp.
      a.m_nLevel = 50; b.m_nLevel = 50; c.m_nLevel = 25;
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      harness.grants.length = 0;
      const n = service.distributeExp(a, mob(50), 100);
      assert.equal(n, 2, 'C excluded from payment by the level gate');
      assert.deepEqual(harness.grants.map((g) => g.id).sort(), [1, 2]);
      // addExp = 100*0.2*(3-1) = 40 -> total 140; denom = 2500+2500+625 = 5625.
      // share = floor(140 * 2500 / 5625) = 62 (NOT 70, which is what filtering
      // C out of the denominator would give).
      assert.deepEqual(harness.grants.map((g) => g.amount), [62, 62]);
    });

    it('applies the PARTY reduce curve off the highest nearby level', () => {
      // maxLv 20 vs mover lv 17 -> delta 3 -> factor 0.35 (party curve;
      // the solo curve would be 0.4 for the same delta).
      a.m_nLevel = 20; b.m_nLevel = 20;
      service.invite(a, 2); service.accept(b, 1);
      harness.grants.length = 0;
      service.distributeExp(a, mob(17), 1000);
      // expValue = 350; addExp = 70 -> total 420; 50/50 -> 210 each.
      assert.deepEqual(harness.grants.map((g) => g.amount), [210, 210]);
    });

    it('caps each member at their OWN nLimitExp', () => {
      a.m_nLevel = 10; b.m_nLevel = 10;
      service.invite(a, 2); service.accept(b, 1);
      harness.grants.length = 0;
      service.distributeExp(a, mob(10), 1_000_000);
      // Level-10 nLimitExp is 69; both shares clamp to it.
      assert.deepEqual(harness.grants.map((g) => g.amount), [69, 69]);
    });

    it('members in a different zone are out of range', () => {
      a.m_nLevel = 10; b.m_nLevel = 10; b.m_nZoneId = 2;
      service.invite(a, 2); service.accept(b, 1);
      harness.grants.length = 0;
      assert.equal(
        service.distributeExp(a, mob(10), 100), null,
        'A alone nearby -> solo fallback',
      );
      assert.equal(harness.grants.length, 0);
    });
  });

  describe('party-LEVEL exp (CParty::GetPoint -> SETPARTYEXP)', () => {
    const mob = (level: number) =>
      ({ m_nZoneId: 1, m_nLevel: level, m_vPos: { x: 0, y: 0, z: 0 } }) as never;

    /** The last PARTYEXP body sent to `id`, or undefined. */
    function lastPartyExp(id: number): { exp: number; level: number; point: number } | undefined {
      const hits = harness.sent.filter(
        (s) => s.id === id && subtype(s.buf) === SNAPSHOTTYPE.PARTYEXP,
      );
      const last = hits.at(-1);
      if (!last) return undefined;
      // 14-byte snapshot prefix, then exp/level/point DWORDs.
      return {
        exp: last.buf.readUInt32LE(16), level: last.buf.readUInt32LE(20),
        point: last.buf.readUInt32LE(24),
      };
    }

    it('accrues (monLv/25 + 1) * 10 and pushes PARTYEXP to every member', () => {
      a.m_nLevel = 10; b.m_nLevel = 10;
      service.invite(a, 2); service.accept(b, 1);
      const party = manager.getByMember(1)!;
      assert.equal(party.level, 1, 'ctor seeds level 1');
      harness.sent.length = 0;
      service.distributeExp(a, mob(10), 100);
      // (10/25 -> 0) + 1 = 1 -> 10 exp. Level-1 threshold is 200, no level-up.
      assert.equal(party.exp, 10);
      assert.equal(party.level, 1);
      assert.deepEqual(lastPartyExp(1), { exp: 10, level: 1, point: 0 });
      assert.deepEqual(lastPartyExp(2), { exp: 10, level: 1, point: 0 },
        'every member sees the bar move');
    });

    it('mob level scales via integer division (lv 50 -> 30 exp)', () => {
      a.m_nLevel = 50; b.m_nLevel = 50;
      service.invite(a, 2); service.accept(b, 1);
      const party = manager.getByMember(1)!;
      service.distributeExp(a, mob(50), 100);
      // (50/25 = 2) + 1 = 3 -> 30.
      assert.equal(party.exp, 30);
    });

    it('levels the party ONCE per kill, carrying the remainder', () => {
      a.m_nLevel = 10; b.m_nLevel = 10;
      service.invite(a, 2); service.accept(b, 1);
      const party = manager.getByMember(1)!;
      party.exp = 195; // 5 short of the 200 threshold
      harness.sent.length = 0;
      service.distributeExp(a, mob(10), 100);
      // 195 + 10 = 205 >= 200 -> level 2, carry 5, +15 point.
      assert.equal(party.level, 2);
      assert.equal(party.exp, 5);
      assert.equal(party.point, 15);
      assert.deepEqual(lastPartyExp(1), { exp: 5, level: 2, point: 15 });
    });

    it('gate: a party averaging 5+ levels above the mob earns no party exp', () => {
      a.m_nLevel = 20; b.m_nLevel = 20;
      service.invite(a, 2); service.accept(b, 1);
      const party = manager.getByMember(1)!;
      harness.sent.length = 0;
      // avg 20 - mob 15 = 5, NOT < 5 -> blocked (party.cpp:268).
      service.distributeExp(a, mob(15), 1000);
      assert.equal(party.exp, 0);
      assert.equal(lastPartyExp(1), undefined, 'no PARTYEXP push when gated');
      // avg 20 - mob 16 = 4 < 5 -> allowed.
      service.distributeExp(a, mob(16), 1000);
      assert.equal(party.exp, 10);
    });

    it('a maxed (level 10) solo party stops accruing', () => {
      a.m_nLevel = 10; b.m_nLevel = 10;
      service.invite(a, 2); service.accept(b, 1);
      const party = manager.getByMember(1)!;
      party.level = MAX_PARTY_LEVEL; party.exp = 0;
      harness.sent.length = 0;
      service.distributeExp(a, mob(10), 100);
      assert.equal(party.exp, 0, 'C++ gates on m_nLevel < MAX_PARTYLEVEL');
      assert.equal(party.level, MAX_PARTY_LEVEL);
      assert.equal(lastPartyExp(1), undefined);
    });

    it('partyExpRate scales the accrual', () => {
      const svc = new PartyService({
        playerManager: harness.pm as never, partyManager: manager,
        grantExpAmount: harness.grantExpAmount, partyExpRate: () => 3.0,
      });
      a.m_nLevel = 10; b.m_nLevel = 10;
      svc.invite(a, 2); svc.accept(b, 1);
      const party = manager.getByMember(1)!;
      svc.distributeExp(a, mob(10), 100);
      assert.equal(party.exp, 30, '10 * 3.0');
    });
  });

  describe('item + gold distribution', () => {
    /** Deterministic `random()` for the random-mode / remainder picks. */
    function withRandom(value: number): PartyService {
      return new PartyService({
        playerManager: harness.pm as never,
        partyManager: manager,
        grantExpAmount: harness.grantExpAmount,
        random: () => value,
      });
    }

    it('player-dropped piles are never redistributed', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.changeItemMode(a, 3); // random
      assert.equal(service.pickItemReceiver(a, false), null);
      assert.equal(service.splitGold(a, 100, false), null);
    });

    it('mode 0 (finder) keeps the item', () => {
      service.invite(a, 2); service.accept(b, 1);
      assert.equal(service.pickItemReceiver(a, true), null, 'null = finder keeps');
    });

    it('mode 1 (sequential) rotates over nearby members', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      service.changeItemMode(a, 1);
      // No previous getter -> candidates[0] = the leader (A = the finder here).
      assert.equal(service.pickItemReceiver(a, true), null, 'A first (finder)');
      // Cursor now on A -> next is B, then C, then wraps to A.
      assert.equal(service.pickItemReceiver(a, true)?.m_idPlayer, 2);
      assert.equal(service.pickItemReceiver(a, true)?.m_idPlayer, 3);
      assert.equal(service.pickItemReceiver(a, true), null, 'wrapped to A');
    });

    it('mode 1 skips a member who walked out of range', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      service.changeItemMode(a, 1);
      service.pickItemReceiver(a, true);               // A
      assert.equal(service.pickItemReceiver(a, true)?.m_idPlayer, 2); // B
      b.m_vPos = { x: 500, y: 0, z: 0 };               // B leaves
      // Cursor id (B) is no longer a candidate -> falls back to candidates[0].
      assert.equal(service.pickItemReceiver(a, true), null, 'A takes it');
    });

    it('mode 2 (leader) gives it to the leader when in range', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.changeItemMode(a, 2);
      // B finds it, A (leader) is in range -> A receives.
      assert.equal(service.pickItemReceiver(b, true)?.m_idPlayer, 1);
      // Leader out of range -> the finder keeps it.
      a.m_vPos = { x: 500, y: 0, z: 0 };
      assert.equal(service.pickItemReceiver(b, true), null);
    });

    it('mode 3 (random) picks by the injected rng', () => {
      const svc = withRandom(0.99);
      svc.invite(a, 2); svc.accept(b, 1);
      svc.changeItemMode(a, 3);
      // 0.99 * 2 candidates -> index 1 = B.
      assert.equal(svc.pickItemReceiver(a, true)?.m_idPlayer, 2);
    });

    it('item range is 32m, not the 64m exp radius', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.changeItemMode(a, 2); // leader mode
      b.m_vPos = { x: 0, y: 0, z: 0 };
      // B finds it at 40m from the leader: inside exp range, outside item range.
      b.m_vPos = { x: 40, y: 0, z: 0 };
      assert.equal(service.pickItemReceiver(b, true), null, 'leader out of 32m');
    });

    it('gold splits evenly regardless of item mode, remainder to one member', () => {
      const svc = withRandom(0);
      svc.invite(a, 2); svc.accept(b, 1);
      svc.invite(a, 3); svc.accept(c, 1);
      const shares = svc.splitGold(a, 100, true);
      assert.ok(shares);
      // 100 / 3 = 33 each, remainder 1 to candidates[0] (rng 0 -> index 0 = A).
      assert.deepEqual(
        shares!.map((s) => [s.player.m_idPlayer, s.amount]),
        [[1, 34], [2, 33], [3, 33]],
      );
      assert.equal(shares!.reduce((t, s) => t + s.amount, 0), 100, 'no gold lost');
    });

    it('gold outside 32m is not shared', () => {
      service.invite(a, 2); service.accept(b, 1);
      b.m_vPos = { x: 500, y: 0, z: 0 };
      const shares = service.splitGold(a, 100, true);
      assert.deepEqual(shares!.map((s) => [s.player.m_idPlayer, s.amount]), [[1, 100]]);
    });

    it('itemNoticePeers excludes the receiver and returns [] with no party', () => {
      assert.deepEqual(service.itemNoticePeers(a, 1), []);
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      assert.deepEqual(service.itemNoticePeers(a, 2).map((p) => p.m_idPlayer), [1, 3]);
    });
  });

  describe('onDisconnect / onJoin (durable parties)', () => {
    it('leader disconnect promotes an online member + sends PP_REMOVE(1)', () => {
      service.invite(a, 2); service.accept(b, 1);
      service.invite(a, 3); service.accept(c, 1);
      harness.sent.length = 0;
      harness.players.delete(1); // A's socket is gone before the hook runs
      service.onDisconnect(a);
      const party = manager.getByMember(2);
      assert.ok(party, 'party persists');
      assert.equal(party!.members[0], 2, 'b promoted (first online member)');
      assert.deepEqual(party!.members.slice().sort(), [1, 2, 3], 'A stays on the roster');
      assert.ok(harness.sent.some((s) => subtype(s.buf) === SNAPSHOTTYPE.ADDPARTYCHANGELEADER));
      const offline = harness.sent.filter(
        (s) => subtype(s.buf) === SNAPSHOTTYPE.SET_PARTY_MEMBER_PARAM,
      );
      assert.deepEqual(offline.map((s) => s.id), [2, 3], 'both online peers told');
      // Body: idPlayer(DWORD) | nParam(BYTE) | nVal(DWORD) after the 16-byte head.
      assert.equal(offline[0].buf.readUInt32LE(16), 1, 'idPlayer = the leaver');
      assert.equal(offline[0].buf.readUInt8(20), 0, 'PP_REMOVE');
      assert.equal(offline[0].buf.readUInt32LE(21), 1, 'nVal = 1 (offline)');
    });

    it('two-member party survives everyone logging out', () => {
      service.invite(a, 2); service.accept(b, 1);
      harness.players.delete(1);
      service.onDisconnect(a);
      harness.players.delete(2);
      service.onDisconnect(b);
      const party = manager.get(1);
      assert.ok(party, 'party still exists with every member offline');
      assert.deepEqual(party!.members.slice().sort(), [1, 2]);
    });

    it('onJoin re-pushes the roster to the returning member + PP_REMOVE(0) to peers', () => {
      service.invite(a, 2); service.accept(b, 1);
      harness.players.delete(1);
      service.onDisconnect(a);
      a.m_idParty = NULL_ID; // simulate a fresh CPlayer built by JoinService
      harness.players.set(1, a);
      harness.sent.length = 0;
      assert.equal(service.onJoin(a), true);
      assert.equal(a.m_idParty, 1, 'membership restored');
      const roster = harness.sent.filter((s) => subtype(s.buf) === SNAPSHOTTYPE.PARTYMEMBER);
      assert.deepEqual(roster.map((s) => s.id), [1], 'roster to the returner only');
      const back = harness.sent.filter(
        (s) => subtype(s.buf) === SNAPSHOTTYPE.SET_PARTY_MEMBER_PARAM,
      );
      assert.deepEqual(back.map((s) => s.id), [2], 'peer told we are back');
      assert.equal(back[0].buf.readUInt32LE(21), 0, 'nVal = 0 (online)');
    });

    it('onJoin with no party clears a stale m_idParty and sends nothing', () => {
      a.m_idParty = 77;
      assert.equal(service.onJoin(a), false);
      assert.equal(a.m_idParty, NULL_ID);
      assert.equal(harness.sent.length, 0);
    });

    it('the roster snapshot marks offline members with m_bRemove', () => {
      service.invite(a, 2); service.accept(b, 1);
      harness.players.delete(2); // B logs out
      harness.sent.length = 0;
      service.onJoin(a);
      const roster = harness.sent.find((s) => subtype(s.buf) === SNAPSHOTTYPE.PARTYMEMBER)!;
      // Head 16 | idPlayer 4 | leaderName str | memberName str | size 4 |
      // CParty (9 DWORDs + 5 modeTime) | per-member { id, remove }.
      // Simpler: the last 16 bytes are the two member trailers.
      const tail = roster.buf.subarray(roster.buf.length - 16);
      assert.equal(tail.readUInt32LE(0), 1, 'leader = A');
      assert.equal(tail.readUInt32LE(4), 0, 'A online');
      assert.equal(tail.readUInt32LE(8), 2, 'member = B');
      assert.equal(tail.readUInt32LE(12), 1, 'B flagged offline');
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
