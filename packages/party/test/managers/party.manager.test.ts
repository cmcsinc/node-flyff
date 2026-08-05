/**
 * PartyManager tests -- create/add/remove/disband/promote/round-robin/invite/
 * onDisconnect.
 * @module managers/party.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PartyManager, PARTY_INVITE_TIMEOUT_MS, MAX_PARTY_MEMBERS,
} from '../../src/managers/party.manager';

describe('PartyManager', () => {
  let mgr: PartyManager;
  beforeEach(() => { mgr = new PartyManager(); });

  it('create returns a 2-member party with members[0]=leader and an auto-increment id', () => {
    const p1 = mgr.create(1, 2);
    const p2 = mgr.create(3, 4);
    assert.deepEqual(p1.members, [1, 2]);
    assert.deepEqual(p2.members, [3, 4]);
    assert.equal(p2.id, p1.id + 1);
  });

  it('getByMember resolves the party for any member', () => {
    const p = mgr.create(1, 2);
    assert.equal(mgr.getByMember(1), p);
    assert.equal(mgr.getByMember(2), p);
    assert.equal(mgr.getByMember(99), undefined);
  });

  it('addMember refuses beyond MAX_PARTY_MEMBERS', () => {
    const p = mgr.create(1, 2);
    for (let i = 3; i <= MAX_PARTY_MEMBERS; i++) assert.ok(mgr.addMember(p.id, i));
    assert.equal(mgr.addMember(p.id, 99), undefined, 'party full refuses 9th');
    assert.equal(mgr.members(p.id).length, MAX_PARTY_MEMBERS);
  });

  it('removeMember disbands (<2) and returns disbanded=true', () => {
    const p = mgr.create(1, 2);
    const res1 = mgr.removeMember(p.id, 2);
    assert.equal(res1.disbanded, true);
    assert.equal(mgr.get(p.id), undefined, 'party deleted on disband');
  });

  it('removeMember keeps party (>=2) and returns disbanded=false', () => {
    const p = mgr.create(1, 2);
    mgr.addMember(p.id, 3);
    const res = mgr.removeMember(p.id, 3);
    assert.equal(res.disbanded, false);
    assert.deepEqual(mgr.members(p.id), [1, 2]);
  });

  it('promoteLeader swaps target into members[0]', () => {
    const p = mgr.create(1, 2);
    mgr.addMember(p.id, 3);
    mgr.promoteLeader(p.id, 3);
    assert.equal(mgr.members(p.id)[0], 3);
  });

  it('promoteLeader returns undefined for a non-member or the current leader', () => {
    const p = mgr.create(1, 2);
    // C++ ChangeLeader feeds FindMember's -1 into SwapPartyMember -> OOB memcpy.
    assert.equal(mgr.promoteLeader(p.id, 999), undefined);
    assert.equal(mgr.promoteLeader(p.id, 1), undefined, 'already leader');
    assert.deepEqual(mgr.members(p.id), [1, 2], 'roster untouched');
  });

  it('advanceToTroupe sets kindTroup=1 + name, and clamps the name length', () => {
    const p = mgr.create(1, 2);
    assert.equal(p.kindTroup, 0);
    assert.equal(p.name, '');
    mgr.advanceToTroupe(p.id, 'Braves');
    assert.equal(mgr.get(p.id)!.kindTroup, 1);
    assert.equal(mgr.get(p.id)!.name, 'Braves');
    mgr.advanceToTroupe(p.id, 'x'.repeat(40));
    assert.equal(mgr.get(p.id)!.name.length, 32, 'clamped to m_sParty capacity');
    assert.equal(mgr.advanceToTroupe(999, 'Nope'), undefined);
  });

  it('nextSequentialLooter advances past the recorded getter and wraps', () => {
    const p = mgr.create(1, 2);
    mgr.addMember(p.id, 3);
    const all = [1, 2, 3];
    // No recorded getter yet -> candidates[0].
    assert.equal(mgr.nextSequentialLooter(p.id, all), 1);
    mgr.setLastItemGetter(p.id, 1);
    assert.equal(mgr.nextSequentialLooter(p.id, all), 2);
    mgr.setLastItemGetter(p.id, 2);
    assert.equal(mgr.nextSequentialLooter(p.id, all), 3);
    mgr.setLastItemGetter(p.id, 3);
    assert.equal(mgr.nextSequentialLooter(p.id, all), 1, 'wraps to the first');
  });

  it('nextSequentialLooter falls back to candidates[0] when the getter is out of range', () => {
    const p = mgr.create(1, 2);
    mgr.addMember(p.id, 3);
    mgr.setLastItemGetter(p.id, 2);
    // 2 is not among the candidates (walked away) -> first candidate takes it.
    assert.equal(mgr.nextSequentialLooter(p.id, [1, 3]), 1);
  });

  it('nextSequentialLooter is undefined with no candidates or unknown party', () => {
    const p = mgr.create(1, 2);
    assert.equal(mgr.nextSequentialLooter(p.id, []), undefined);
    assert.equal(mgr.nextSequentialLooter(9999, [1]), undefined);
  });

  it('pending invite CRUD + TTL constant', () => {
    assert.equal(PARTY_INVITE_TIMEOUT_MS, 30_000);
    const timer = setTimeout(() => {}, 1000);
    mgr.addPending({ leaderId: 1, memberId: 2, expiresAt: 0, timer });
    assert.ok(mgr.hasPending(2));
    const removed = mgr.removePending(2);
    assert.equal(removed?.leaderId, 1);
    assert.ok(!mgr.hasPending(2));
  });

  it('onDisconnect clears pending-as-leader but KEEPS the member on the roster', () => {
    const p = mgr.create(1, 2);
    mgr.addMember(p.id, 3);
    const t1 = setTimeout(() => {}, 1000);
    mgr.addPending({ leaderId: 4, memberId: 5, expiresAt: 0, timer: t1 });
    // Parties are durable (migration 022): a logout marks the member offline,
    // it never shrinks the roster.
    const res = mgr.onDisconnect(3);
    assert.equal(res.wasLeader, false);
    assert.deepEqual(mgr.members(p.id), [1, 2, 3], 'roster intact');
    assert.ok(mgr.hasPending(5), 'an unrelated invite is untouched');
    // Leader disconnect reports wasLeader and still keeps everyone.
    const res2 = mgr.onDisconnect(1);
    assert.equal(res2.wasLeader, true);
    assert.deepEqual(mgr.members(p.id), [1, 2, 3]);
    assert.ok(mgr.get(p.id), 'all-offline party survives');
  });

  it('onDisconnect clears a pending invite the leaver had issued', () => {
    const t = setTimeout(() => {}, 1000);
    mgr.addPending({ leaderId: 7, memberId: 8, expiresAt: 0, timer: t });
    mgr.onDisconnect(7);
    assert.ok(!mgr.hasPending(8), 'invites from a departing leader are dropped');
  });

  it('hydrate reloads rosters, seeds the id counter, and prunes size<2', () => {
    const repo = {
      loadAll: async () => [
        {
          id: 4, kindTroup: 1, name: 'Troupe', level: 3, exp: 20, point: 45,
          expMode: 0, itemMode: 2, lastItemGetterId: 9, members: [5, 6, 7],
        },
        // A character was deleted while offline -> cascade left one member.
        {
          id: 9, kindTroup: 0, name: '', level: 1, exp: 0, point: 0,
          expMode: 0, itemMode: 0, lastItemGetterId: 0, members: [8],
        },
      ],
      maxId: async () => 9,
      create: async () => {},
      update: async () => {},
      replaceMembers: async () => {},
      remove: async (id: number) => { removed.push(id); },
    };
    const removed: number[] = [];
    const m = new PartyManager(repo);
    return m.hydrate().then(() => {
      const p = m.get(4);
      assert.ok(p);
      assert.deepEqual(p!.members, [5, 6, 7], 'slot order preserved (leader first)');
      assert.equal(p!.itemMode, 2);
      assert.equal(p!.level, 3);
      assert.equal(p!.kindTroup, 1);
      assert.equal(p!.name, 'Troupe');
      assert.equal(m.get(9), undefined, 'size<2 pruned');
      assert.deepEqual(removed, [9], 'pruned party deleted from the DB too');
      // Counter continues past the highest stored id -- a fresh party must not
      // collide with a hydrated one.
      assert.equal(m.create(20, 21).id, 10);
    });
  });

  it('mutations write through to the repo', () => {
    const calls: string[] = [];
    const m = new PartyManager({
      loadAll: async () => [],
      maxId: async () => 0,
      create: async () => { calls.push('create'); },
      update: async () => { calls.push('update'); },
      replaceMembers: async () => { calls.push('members'); },
      remove: async () => { calls.push('remove'); },
    });
    const p = m.create(1, 2);
    m.addMember(p.id, 3);
    m.promoteLeader(p.id, 3);
    m.setItemMode(p.id, 1);
    m.removeMember(p.id, 3);
    m.removeMember(p.id, 2); // drops below 2 -> delete
    assert.deepEqual(calls, ['create', 'members', 'members', 'update', 'members', 'remove']);
  });
});
