/**
 * DestPollService test -- the QUERYGETPOS refresh that keeps a walking player's
 * server-side position fresh while the client auto-walks to a destination object
 * (follow a player, approach a mob/NPC, walk to a ground pile).
 *
 * The bug it fixes: the client sends NO movement packet during that walk, so
 * `m_vPos` stayed at the click point and every range gate (party exp/item
 * proximity, skill reach, loot arrival, vicinity) read it stale until the player
 * clicked the ground.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DestPollService } from '../../src/services/destPoll.service';
import { NULL_ID, SNAPSHOTTYPE_QUERYGETPOS } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

/** Subtype WORD of a self-snapshot: offset 14 (after SNAPSHOT hdr + objid). */
function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

interface Harness {
  svc: DestPollService;
  player: CPlayer;
  sent: Buffer[];
  /** Mutable so a test can make the player vanish (disconnect) mid-walk. */
  live: { value: CPlayer | undefined };
}

function setup(destObj = 0x40000007): Harness {
  const player = {
    m_idPlayer: 42, m_idDestObj: destObj, m_fArrivalRange: 0,
    m_nZoneId: 1, m_vPos: { x: 100, y: 0, z: 100 },
  } as unknown as CPlayer;
  const live: { value: CPlayer | undefined } = { value: player };
  const sent: Buffer[] = [];
  const svc = new DestPollService({
    playerManager: {
      get: () => live.value,
      sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); },
    } as unknown as PlayerManager,
  });
  return { svc, player, sent, live };
}

describe('DestPollService', () => {
  // mock.timers.enable() is session-global -- reset per test (memory
  // `node-test-mock-timers-gotcha`).
  beforeEach(() => { mock.timers.enable({ apis: ['setInterval', 'Date'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('polls QUERYGETPOS while a destination object is set', () => {
    const { svc, player, sent } = setup();
    svc.arm(player);
    assert.equal(sent.length, 0, 'nothing sent synchronously');

    mock.timers.tick(300);
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE_QUERYGETPOS);
    // idFrom must be NULL_ID or `OnGetPos` (DPSrvr.cpp:1463) will not take the
    // reported position as the sender's own.
    assert.equal(sent[0]!.readUInt32LE(16), NULL_ID, 'idFrom = NULL_ID');

    mock.timers.tick(500);
    assert.equal(sent.length, 3, 'keeps sampling for the whole walk');
  });

  it('polls a followed PLAYER, not just a ground pile', () => {
    // The regression: only item destinations were polled, so following another
    // player never refreshed position. Any dest objid must arm the poll.
    const { svc, player, sent } = setup(77 /* another player's objid */);
    svc.arm(player);
    mock.timers.tick(300);
    assert.equal(sent.length, 1, 'a player destination polls too');
  });

  it('stops once the destination is cleared (arrival)', () => {
    const { svc, player, sent } = setup();
    svc.arm(player);
    mock.timers.tick(300);
    const before = sent.length;

    player.m_idDestObj = NULL_ID; // arrived / click-to-move cancelled the follow
    mock.timers.tick(2_000);
    assert.equal(sent.length, before, 'no further asks with no destination');
    assert.equal(svc.size, 0, 'timer cleared, not just idle');
  });

  it('arming with no destination is a no-op', () => {
    const { svc, player, sent } = setup(NULL_ID);
    svc.arm(player);
    mock.timers.tick(2_000);
    assert.equal(sent.length, 0);
    assert.equal(svc.size, 0);
  });

  it('re-arming replaces the previous timer rather than stacking', () => {
    const { svc, player, sent } = setup();
    svc.arm(player);
    svc.arm(player);
    svc.arm(player);
    assert.equal(svc.size, 1, 'one timer per player');
    mock.timers.tick(300);
    assert.equal(sent.length, 1, 'a follow re-issue must not multiply the polls');
  });

  it('stops when the player disconnects (rule 05 -- no pinned CPlayer)', () => {
    const { svc, player, sent, live } = setup();
    svc.arm(player);
    mock.timers.tick(300);
    const before = sent.length;

    live.value = undefined; // dropped from PlayerManager
    mock.timers.tick(2_000);
    assert.equal(sent.length, before);
    assert.equal(svc.size, 0);
  });

  it('cancel() stops one player; shutdown() stops all', () => {
    const a = setup();
    a.svc.arm(a.player);
    a.svc.cancel(a.player.m_idPlayer);
    mock.timers.tick(2_000);
    assert.equal(a.sent.length, 0);

    const b = setup();
    b.svc.arm(b.player);
    b.svc.shutdown();
    mock.timers.tick(2_000);
    assert.equal(b.sent.length, 0);
    assert.equal(b.svc.size, 0);
  });

  it('gives up at the timeout when the client stopped short', () => {
    const { svc, player, sent } = setup();
    svc.arm(player);
    mock.timers.tick(61_000);
    const atTimeout = sent.length;
    mock.timers.tick(5_000);
    assert.equal(sent.length, atTimeout, 'poll stopped at the deadline');
    assert.equal(svc.size, 0);
  });
});
