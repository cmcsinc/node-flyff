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

  // HITTYPE_WAR -- `GetHitType2` checks `IsWarTarget` after `IsPVPTarget` and
  // BEFORE the `EVE_PK` block (`MoverAttack.cpp:1850-1863`), so a war grants
  // consent on its own exactly like a duel.
  const atWar = (): boolean => true;
  const notAtWar = (): boolean => false;

  it('a war target is attackable with PK mode OFF on both sides', () => {
    const a = flyPlayer(false, { m_idPlayer: 1, m_bPKMode: false } as Partial<CPlayer>);
    const b = flyPlayer(false, { m_idPlayer: 2, m_bPKMode: false } as Partial<CPlayer>);
    assert.equal(isPlayerAttackableBy(a, b), false, 'no consent without the war');
    assert.equal(isPlayerAttackableBy(a, b, atWar), true, 'the war IS the consent');
  });

  it('the war predicate does not override the flight rule', () => {
    const a = flyPlayer(true, { m_idPlayer: 1 });
    const b = flyPlayer(false, { m_idPlayer: 2 });
    assert.equal(isPlayerAttackableBy(a, b, atWar), false);
  });

  it('a false predicate falls through to the normal PK consent gate', () => {
    const on1 = flyPlayer(false, { m_idPlayer: 1 });
    const on2 = flyPlayer(false, { m_idPlayer: 2 });
    assert.equal(isPlayerAttackableBy(on1, on2, notAtWar), true, 'both PK on');
    const off = flyPlayer(false, { m_idPlayer: 3, m_bPKMode: false } as Partial<CPlayer>);
    assert.equal(isPlayerAttackableBy(on1, off, notAtWar), false);
  });

  it('omitting the predicate entirely means no war targets (EVE_GUILDWAR = 0)', () => {
    const a = flyPlayer(false, { m_idPlayer: 1, m_bPKMode: false } as Partial<CPlayer>);
    const b = flyPlayer(false, { m_idPlayer: 2, m_bPKMode: false } as Partial<CPlayer>);
    assert.equal(isPlayerAttackableBy(a, b), false);
  });

  // War SUPPRESSES ordinary PK (`MoverAttack.cpp:1945-1949`): with the flag on, a
  // player in ANY war can neither PK nor be PK'd by anyone outside that war.
  const inWar = (p: CPlayer): boolean => p.m_idPlayer === 1;
  const nobodyAtWar = (): boolean => false;

  it('a warring player cannot PK an unrelated stranger, even with both PK modes on', () => {
    const warrior = flyPlayer(false, { m_idPlayer: 1 });
    const bystander = flyPlayer(false, { m_idPlayer: 2 });
    assert.equal(isPlayerAttackableBy(warrior, bystander, notAtWar), true, 'without the rule');
    assert.equal(isPlayerAttackableBy(warrior, bystander, notAtWar, inWar), false);
  });

  it('and the stranger cannot PK them back', () => {
    const bystander = flyPlayer(false, { m_idPlayer: 2 });
    const warrior = flyPlayer(false, { m_idPlayer: 1 });
    assert.equal(isPlayerAttackableBy(bystander, warrior, notAtWar, inWar), false);
  });

  it('but the war ENEMY is still attackable -- suppression runs after the war branch', () => {
    const a = flyPlayer(false, { m_idPlayer: 1, m_bPKMode: false } as Partial<CPlayer>);
    const b = flyPlayer(false, { m_idPlayer: 2, m_bPKMode: false } as Partial<CPlayer>);
    assert.equal(isPlayerAttackableBy(a, b, atWar, inWar), true);
  });

  it('a duel still overrides suppression -- the duel branch is checked first', () => {
    const a = flyPlayer(false, { m_idPlayer: 1, m_nDuel: 1, m_idDuelTarget: 2 } as Partial<CPlayer>);
    const b = flyPlayer(false, { m_idPlayer: 2 });
    assert.equal(isPlayerAttackableBy(a, b, notAtWar, inWar), true);
  });

  it('nobody at war leaves normal PK untouched', () => {
    const a = flyPlayer(false, { m_idPlayer: 1 });
    const b = flyPlayer(false, { m_idPlayer: 2 });
    assert.equal(isPlayerAttackableBy(a, b, notAtWar, nobodyAtWar), true);
  });
});
