import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TargetService } from '../../src/services/target.service';
import type { SpawnManager } from '../../src/managers/spawn.manager';
import type { CMover } from '../../src/entities/mover';
import type { CPlayer } from '../../src/entities/player';
import { NULL_ID } from '../../src/net/snapshot/constants';

/** Mutatable player stub with the fields TargetService touches. */
function fakePlayer(pk = false): CPlayer {
  return {
    m_idTarget: NULL_ID,
    m_idSetTarget: NULL_ID,
    m_dwPKPropensity: pk ? 1 : 0,
    _dirty: new Set<string>(),
    isChaotic: () => pk,
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
    const svc = new TargetService({ spawnManager: fakeSpawnManager(200, moverOf({ attackable: true, guard: true })) });
    const p = fakePlayer(true);
    const out = svc.setTarget(p, 200, 0);
    assert.deepEqual(out, { ok: true, mode: 'claim' });
    assert.equal(p.m_idTarget, 200);
  });

  it('allows a claim on a normal monster', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(300, moverOf({ attackable: true, guard: false })) });
    const out = svc.setTarget(fakePlayer(false), 300, 0);
    assert.deepEqual(out, { ok: true, mode: 'claim' });
  });

  it('falls through for an unknown (player) target id', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(null, null) });
    const out = svc.setTarget(fakePlayer(false), 9999, 0);
    assert.deepEqual(out, { ok: true, mode: 'claim' });
  });

  it('release (bClear=1) clears the target lock', () => {
    const svc = new TargetService({ spawnManager: fakeSpawnManager(null, null) });
    const p = fakePlayer(false);
    p.m_idTarget = 555;
    const out = svc.setTarget(p, 555, 1);
    assert.deepEqual(out, { ok: true, mode: 'release' });
    assert.equal(p.m_idTarget, NULL_ID);
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
