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

  it('onDisconnect clears pending-as-leader AND removes from active party', () => {
    const p = mgr.create(1, 2);
    mgr.addMember(p.id, 3);
    const t1 = setTimeout(() => {}, 1000);
    mgr.addPending({ leaderId: 4, memberId: 5, expiresAt: 0, timer: t1 });
    // Disconnect member 3 (not leader) -> party persists.
    const res = mgr.onDisconnect(3);
    assert.equal(res.disbanded, false);
    assert.deepEqual(mgr.members(p.id), [1, 2]);
    // Disconnect leader -> auto-promote, party persists at size 1 only if >=2
    // remaining; here size drops to 1 so disband.
    const res2 = mgr.onDisconnect(1);
    assert.equal(res2.disbanded, true);
    assert.equal(res2.wasLeader, true);
    assert.equal(mgr.get(p.id), undefined);
  });
});
