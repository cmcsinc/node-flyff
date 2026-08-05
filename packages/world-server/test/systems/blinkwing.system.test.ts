/**
 * BlinkwingSystem test -- the channel-completion poll.
 *
 * Three behaviours: a channel fires only once its `m_nReadyTime` has passed, an
 * idle player is never touched, and a player who died mid-cast has the channel
 * cancelled instead of teleporting (C++ `CMover::DoDie`, `Mover.cpp:5391`).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { CPlayer } from '@flyff/entities';
import { BlinkwingSystem } from '../../src/systems/blinkwing.system';

function makeSut(players: CPlayer[]) {
  const completed: number[] = [];
  const cancelled: number[] = [];
  const sys = new BlinkwingSystem({
    playerManager: { all: () => players } as never,
    blinkwingService: {
      complete: (p: CPlayer) => { completed.push(p.m_idPlayer); },
      cancel: (p: CPlayer) => { cancelled.push(p.m_idPlayer); },
    } as never,
  });
  return { sys, completed, cancelled };
}

function fake(id: number, readyTime: number, dead = false): CPlayer {
  return { m_idPlayer: id, m_nReadyTime: readyTime, m_bDead: dead } as CPlayer;
}

describe('BlinkwingSystem.tick', () => {
  it('completes only channels whose ready time has elapsed', () => {
    const now = 1_000_000;
    const players = [fake(1, now - 1), fake(2, now + 5_000), fake(3, now)];
    const { sys, completed, cancelled } = makeSut(players);

    sys.tick(now);

    assert.deepEqual(completed, [1, 3], 'elapsed + exactly-due fire; pending does not');
    assert.deepEqual(cancelled, []);
  });

  it('ignores players with no channel armed', () => {
    const { sys, completed, cancelled } = makeSut([fake(1, 0)]);

    sys.tick(Date.now());

    assert.deepEqual(completed, []);
    assert.deepEqual(cancelled, []);
  });

  it('cancels a dead caster rather than waiting out the timer', () => {
    const now = 1_000_000;
    // Not yet due -- a dead caster must be released immediately, not in 5 minutes.
    const { sys, completed, cancelled } = makeSut([fake(7, now + 299_000, true)]);

    sys.tick(now);

    assert.deepEqual(completed, []);
    assert.deepEqual(cancelled, [7]);
  });
});
