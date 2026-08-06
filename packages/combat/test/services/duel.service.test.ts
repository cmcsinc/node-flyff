/**
 * DuelService tests -- propose/accept/decline state machine + death teardown.
 * @module services/duel.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DuelService } from '../../src/services/duel.service';
import { DuelManager } from '../../src/managers/duel.manager';
import { NULL_ID } from '@flyff/world-core';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import type { CPlayer } from '@flyff/entities';

/** Subtype WORD at offset 14 of a self-snapshot frame. */
function subtype(buf: Buffer): number { return buf.readUInt16LE(14); }

interface MockPlayer {
  m_idPlayer: number;
  m_idDuelTarget: number;
  m_nDuel: number;
}
function makePlayer(id: number): MockPlayer & CPlayer {
  return { m_idPlayer: id, m_idDuelTarget: NULL_ID, m_nDuel: 0 } as MockPlayer & CPlayer;
}

function makePlayerManager(players: Map<number, CPlayer>) {
  const sent: Array<{ id: number; buf: Buffer }> = [];
  return {
    pm: {
      get: (id: number) => players.get(id) ?? null,
      sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
    },
    sent,
  };
}

describe('DuelService', () => {
  let players: Map<number, CPlayer>;
  let a: MockPlayer & CPlayer;
  let b: MockPlayer & CPlayer;
  let manager: DuelManager;
  let service: DuelService;
  let harness: ReturnType<typeof makePlayerManager>;

  beforeEach(() => {
    a = makePlayer(1); b = makePlayer(2);
    players = new Map([[1, a], [2, b]]);
    manager = new DuelManager();
    harness = makePlayerManager(players);
    service = new DuelService({ playerManager: harness.pm as any, duelManager: manager });
  });

  it('request registers pending + sends DUELREQUEST to target only', () => {
    service.request(a, 2);
    assert.ok(manager.hasPending(2), 'pending registered for target B');
    assert.equal(harness.sent.length, 1, 'exactly one packet sent');
    assert.equal(harness.sent[0].id, 2, 'sent to B');
    assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.DUELREQUEST);
  });

  it('accept flips both flags + sends SETDUEL and DUELSTART to both', () => {
    service.request(a, 2);
    harness.sent.length = 0;
    service.accept(b, 1);
    assert.equal(a.m_idDuelTarget, 2);
    assert.equal(b.m_idDuelTarget, 1);
    assert.equal(a.m_nDuel, 1);
    assert.equal(b.m_nDuel, 1);
    assert.ok(!manager.hasPending(2), 'pending cleared on accept');
    const types = harness.sent.map((s) => subtype(s.buf));
    // Service order: SETDUEL(A), SETDUEL(B), DUELSTART(A), DUELSTART(B)
    assert.deepEqual(types, [SNAPSHOTTYPE.SETDUEL, SNAPSHOTTYPE.SETDUEL, SNAPSHOTTYPE.DUELSTART, SNAPSHOTTYPE.DUELSTART]);
  });

  it('declineByTarget clears pending + sends DUELNO to challenger', () => {
    service.request(a, 2);
    harness.sent.length = 0;
    service.declineByTarget(b);
    assert.ok(!manager.hasPending(2));
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].id, 1, 'DUELNO sent to A');
    assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.DUELNO);
  });

  it('onPlayerDeath clears both duelists + sends DUELCANCEL to both', () => {
    service.request(a, 2);
    service.accept(b, 1);
    harness.sent.length = 0;
    service.onPlayerDeath(a);
    assert.equal(a.m_idDuelTarget, NULL_ID);
    assert.equal(b.m_idDuelTarget, NULL_ID);
    assert.equal(a.m_nDuel, 0);
    assert.equal(b.m_nDuel, 0);
    assert.equal(harness.sent.length, 2, 'DUELCANCEL to both');
    assert.ok(harness.sent.every((s) => subtype(s.buf) === SNAPSHOTTYPE.DUELCANCEL));
  });

  it('request rejects if challenger already dueling', () => {
    a.m_idDuelTarget = 9;
    service.request(a, 2);
    assert.ok(!manager.hasPending(2));
    assert.equal(harness.sent.length, 0);
  });

  // `CMover::CanDuel` bails with TID_GAME_GUILDWARERRORDUEL while the challenger
  // is in a guild war (`Mover.cpp:7173-7181`) -- a duel would otherwise let two
  // warring players out of the war's targeting rules.
  describe('guild-war refusal', () => {
    /** Recorded refusal texts -- we assert the TID, not the bytes. */
    let notices: Array<{ id: number; tid: number }>;

    function withWar(atWarIds: number[]): DuelService {
      notices = [];
      return new DuelService({
        playerManager: harness.pm as any,
        duelManager: manager,
        isInWar: (p: CPlayer) => atWarIds.includes(p.m_idPlayer),
        sendDefinedText: (p: CPlayer, tid: number) => { notices.push({ id: p.m_idPlayer, tid }); },
      });
    }

    it('refuses when the CHALLENGER is at war, and says why', () => {
      withWar([1]).request(a, 2);
      assert.ok(!manager.hasPending(2));
      assert.equal(harness.sent.length, 0);
      // TID_GAME_GUILDWARERRORDUEL (Mover.cpp:7178) -- to the CHALLENGER.
      assert.deepEqual(notices, [{ id: 1, tid: 1294 }]);
    });

    it('refuses when the TARGET is at war', () => {
      withWar([2]).request(a, 2);
      assert.ok(!manager.hasPending(2));
      assert.equal(harness.sent.length, 0);
      assert.deepEqual(notices, [{ id: 1, tid: 1294 }]);
    });

    it('allows the duel when neither is at war, and says nothing', () => {
      withWar([99]).request(a, 2);
      assert.ok(manager.hasPending(2));
      assert.equal(notices.length, 0);
    });
  });
});
