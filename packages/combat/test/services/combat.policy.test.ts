import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CMover } from '@flyff/entities';
import type { CPlayer } from '@flyff/entities';
import { isMoverAttackableBy, isPlayerAttackableBy } from '../../src/services/combat.policy';

/** Minimal PK-aware player stub. */
function fakePlayer(pk = false): CPlayer {
  return {
    m_dwPKPropensity: pk ? 1 : 0,
    isChaotic: () => pk,
    isFly: () => false,
  } as unknown as CPlayer;
}

/** Spawn a mover with the given combat flags. */
function makeMover(opts: { attackable?: boolean; guard?: boolean; chaoGuard?: boolean }): CMover {
  return CMover.spawn(
    0x40000000,
    {
      modelIndex: 20,
      level: 1,
      hp: 50,
      name: 'x',
      attackable: opts.attackable ?? true,
      guard: opts.guard ?? false,
      chaoGuard: opts.chaoGuard ?? false,
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

  it('a chao-guardian IS attackable by a non-chaotic player', () => {
    const chao = makeMover({ attackable: true, chaoGuard: true });
    assert.equal(isMoverAttackableBy(fakePlayer(false), chao), true);
  });

  it('a chao-guardian is NOT attackable by a chaotic (PK) player', () => {
    const chao = makeMover({ attackable: true, chaoGuard: true });
    assert.equal(isMoverAttackableBy(fakePlayer(true), chao), false);
  });
});

describe('isMoverAttackableBy -- air/ground parity (Mover.cpp:6822)', () => {
  // C++ gates on `IsFly() == propMover.dwFlying`. A flying player can only hit a
  // flying mob; a grounded player only a grounded one. `m_bFlyable` is the
  // converted `bFlying` bit.
  function flyPlayer(fly: boolean): CPlayer {
    return { isFly: () => fly, isChaotic: () => false } as unknown as CPlayer;
  }
  function makeMoverFly(flyable: boolean): CMover {
    return CMover.spawn(
      0x40000000,
      { modelIndex: 20, level: 1, hp: 50, name: 'x', attackable: true, flyable },
      { x: 0, y: 0, z: 0 }, 1,
    );
  }
  it('grounded player -> grounded mob: allowed', () => {
    assert.equal(isMoverAttackableBy(flyPlayer(false), makeMoverFly(false)), true);
  });
  it('flying player -> flying mob: allowed', () => {
    assert.equal(isMoverAttackableBy(flyPlayer(true), makeMoverFly(true)), true);
  });
  it('flying player -> grounded mob: rejected', () => {
    assert.equal(isMoverAttackableBy(flyPlayer(true), makeMoverFly(false)), false);
  });
  it('grounded player -> flying mob: rejected', () => {
    assert.equal(isMoverAttackableBy(flyPlayer(false), makeMoverFly(true)), false);
  });
});

describe('isPlayerAttackableBy -- flight forbids PvP (MoverAttack.cpp:1848)', () => {
  // C++ returns HITTYPE_FAIL before any duel/PvP check when either side flies.
  function flyPlayer(fly: boolean, over: Partial<CPlayer> = {}): CPlayer {
    return {
      isFly: () => fly,
      m_bPKMode: true,
      m_nDuel: 0,
      m_idDuelTarget: 0,
      m_idPlayer: 1,
      ...over,
    } as unknown as CPlayer;
  }
  it('both grounded + PK on -> allowed', () => {
    assert.equal(isPlayerAttackableBy(flyPlayer(false, { m_idPlayer: 1 }), flyPlayer(false, { m_idPlayer: 2 })), true);
  });
  it('attacker flying -> rejected (before duel/consent)', () => {
    assert.equal(isPlayerAttackableBy(flyPlayer(true, { m_idPlayer: 1 }), flyPlayer(false, { m_idPlayer: 2 })), false);
  });
  it('target flying -> rejected', () => {
    assert.equal(isPlayerAttackableBy(flyPlayer(false, { m_idPlayer: 1 }), flyPlayer(true, { m_idPlayer: 2 })), false);
  });
});
