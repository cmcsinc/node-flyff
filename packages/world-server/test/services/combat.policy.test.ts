import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CMover } from '../../src/entities/mover.js';
import type { CPlayer } from '../../src/entities/player.js';
import { isMoverAttackableBy } from '../../src/services/combat.policy.js';

/** Minimal PK-aware player stub. */
function fakePlayer(pk = false): CPlayer {
  return {
    m_dwPKPropensity: pk ? 1 : 0,
    isChaotic: () => pk,
  } as unknown as CPlayer;
}

/** Spawn a mover with the given combat flags. */
function makeMover(opts: { attackable?: boolean; guard?: boolean }): CMover {
  return CMover.spawn(
    0x40000000,
    {
      modelIndex: 20,
      level: 1,
      hp: 50,
      name: 'x',
      attackable: opts.attackable ?? true,
      guard: opts.guard ?? false,
    },
    { x: 0, y: 0, z: 0 },
    1,
  );
}

describe('isMoverAttackableBy (combat.policy)', () => {
  it('a normal monster is attackable by a non-PK player', () => {
    const monster = makeMover({ attackable: true, guard: false });
    assert.equal(isMoverAttackableBy(fakePlayer(false), monster), true);
  });

  it('a peaceful NPC (attackable=false) is never attackable, even by PK', () => {
    const npc = makeMover({ attackable: false, guard: false });
    assert.equal(isMoverAttackableBy(fakePlayer(false), npc), false);
    assert.equal(isMoverAttackableBy(fakePlayer(true), npc), false);
  });

  it('a guard is NOT attackable by a non-PK player', () => {
    const guard = makeMover({ attackable: true, guard: true });
    assert.equal(isMoverAttackableBy(fakePlayer(false), guard), false);
  });

  it('a guard IS attackable by a player killer (chaotic)', () => {
    const guard = makeMover({ attackable: true, guard: true });
    assert.equal(isMoverAttackableBy(fakePlayer(true), guard), true);
  });
});
