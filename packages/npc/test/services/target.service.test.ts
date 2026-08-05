import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TargetService } from '../../src/services/target.service';
import type { SpawnManager } from '@flyff/world-core';
import type { CMover } from '@flyff/entities';
import type { CPlayer } from '@flyff/entities';
import { NULL_ID } from '@flyff/world-core';

/** Mutatable player stub with the fields TargetService touches. */
function fakePlayer(pk = false): CPlayer {
  return {
    m_idPlayer: pk ? 9001 : 1001,
    m_idTarget: NULL_ID,
    m_idSetTarget: NULL_ID,
    m_dwPKPropensity: pk ? 1 : 0,
    _dirty: new Set<string>(),
    isChaotic: () => pk,
    isFly: () => false,
  } as unknown as CPlayer;
}

/** SpawnManager stub whose `get` returns `hit` when `id === hitId`. */
function fakeSpawnManager(hitId: number | null, hit: CMover | null): SpawnManager {
  return {
    get: (id: number) => (id === hitId && hit ? hit : undefined),
  } as unknown as SpawnManager;
}

/** Build a CMover with combat flags. */
function moverOf(opts: { attackable?: boolean; guard?: boolean }): CMover {
  return {
    m_bAttackable: opts.attackable ?? true,
    m_bGuard: opts.guard ?? false,
    m_bFlyable: false,
    m_idTargeter: NULL_ID,
  } as unknown as CMover;
}

describe('TargetService', () => {
  it('rejects a claim on a peaceful NPC with target_not_attackable', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(100, moverOf({ attackable: false })) });
    const p = fakePlayer(false);
    const out = svc.setTarget(p, 100, 0);
    assert.deepEqual(out, { ok: false, reason: 'target_not_attackable' });
    assert.equal(p.m_idTarget, NULL_ID, 'target lock not stored on reject');
  });

  it('rejects a claim on a guard by a non-PK player', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(200, moverOf({ attackable: true, guard: true })) });
    const out = svc.setTarget(fakePlayer(false), 200, 0);
    assert.deepEqual(out, { ok: false, reason: 'target_not_attackable' });
  });

  it('allows a claim on a guard when the player is PK', () => {
    const mover = moverOf({ attackable: true, guard: true });
    const svc = new TargetService({ spawnManager: fakeSpawnManager(200, mover) });
    const p = fakePlayer(true);
    const out = svc.setTarget(p, 200, 0);
    assert.deepEqual(out, { ok: true, mode: 'claim' });
    assert.equal(mover.m_idTargeter, p.m_idPlayer, 'target m_idTargeter set to claimer');
  });

  it('allows a claim on a normal monster', () => {
    const mover = moverOf({ attackable: true, guard: false });
    const svc = new TargetService({ spawnManager: fakeSpawnManager(300, mover) });
    const p = fakePlayer(false);
    const out = svc.setTarget(p, 300, 0);
    assert.deepEqual(out, { ok: true, mode: 'claim' });
    assert.equal(mover.m_idTargeter, p.m_idPlayer, 'target m_idTargeter set to claimer');
  });

  it('falls through for an unknown (player) target id', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(null, null) });
    const out = svc.setTarget(fakePlayer(false), 9999, 0);
    assert.deepEqual(out, { ok: true, mode: 'claim' });
  });

  it('release (bClear=1) clears the target lock', () => {
    const p = fakePlayer(false);
    const mover = moverOf({ attackable: true });
    mover.m_idTargeter = p.m_idPlayer;
    const svc = new TargetService({ spawnManager: fakeSpawnManager(555, mover) });
    const out = svc.setTarget(p, 555, 1);
    assert.deepEqual(out, { ok: true, mode: 'release' });
    assert.equal(mover.m_idTargeter, NULL_ID, 'target m_idTargeter cleared on release');
  });

  it('objective (bClear=2) sets m_idSetTarget', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(null, null) });
    const p = fakePlayer(false);
    const out = svc.setTarget(p, 4242, 2);
    assert.deepEqual(out, { ok: true, mode: 'set_objective' });
    assert.equal(p.m_idSetTarget, 4242);
  });

  it('rejects an invalid bClear', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(null, null) });
    assert.deepEqual(svc.setTarget(fakePlayer(false), 1, 9), { ok: false, reason: 'invalid_clear' });
  });
});
