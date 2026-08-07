import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RangeAttackService, TID_TIP_NEEDSATTACKITEM } from '../../src/services/rangeAttack.service';
import type { RangeAttackFrame } from '../../src/net/snapshot/rangeAttack.serializer';
import type { ZoneManager } from '@flyff/world-core';
import type { CombatService, CombatOutcome } from '../../src/services/combat.service';
import type { CPlayer } from '@flyff/entities';

const player = { m_idPlayer: 7, m_vPos: { x: 0, y: 0, z: 0 }, m_nZoneId: 1 } as unknown as CPlayer;

function makeDeps(combatOutcome: CombatOutcome, ranged = true, hasArrow?: boolean) {
  const calls = { broadcast: 0, resolved: [] as number[], order: [] as string[], notified: [] as number[], burned: [] as number[] };
  const zoneManager = {
    broadcastAround: () => { calls.broadcast++; calls.order.push('broadcast'); return 3; },
  } as unknown as ZoneManager;
  const combatService = {
    resolveAttack: (_p: CPlayer, objid: number) => { calls.resolved.push(objid); return combatOutcome; },
    isRangedWeaponEquipped: () => ranged,
  } as unknown as CombatService;
  const ammo = hasArrow === undefined ? {} : {
    hasArrow: () => hasArrow,
    arrowDown: (_p: CPlayer, n: number) => { calls.burned.push(n); calls.order.push('arrowDown'); },
    notify: (_p: CPlayer, tid: number) => { calls.notified.push(tid); },
  };
  return { deps: { zoneManager, combatService, ...ammo }, calls };
}

const frame = (objid: number): RangeAttackFrame => ({ dwAtkMsg: 35, objid, nParam2: 0, nParam3: 0, idSfxHit: 7 });

describe('RangeAttackService', () => {
  it('rejects NULL_ID target without broadcasting or resolving damage', () => {
    const { deps, calls } = makeDeps({ ok: true, hit: true, damage: 5, killed: false });
    const svc = new RangeAttackService(deps);
    const out = svc.attack(player, frame(0xffffffff));
    assert.deepEqual(out, { ok: false, reason: 'invalid_target' });
    assert.equal(calls.broadcast, 0);
    assert.equal(calls.resolved.length, 0);
  });

  it('broadcasts the ranged swing then runs the shared damage round-trip', () => {
    const { deps, calls } = makeDeps({ ok: true, hit: true, damage: 12, killed: false });
    const svc = new RangeAttackService(deps);
    const out = svc.attack(player, frame(0x40000005));
    assert.deepEqual(out, { ok: true, reached: 3 });
    assert.equal(calls.broadcast, 1);
    assert.deepEqual(calls.resolved, [0x40000005]);
  });

  it('still returns ok (echo fired) even when the damage round-trip is rejected', () => {
    const { deps, calls } = makeDeps({ ok: false, reason: 'target_dead' });
    const svc = new RangeAttackService(deps);
    const out = svc.attack(player, frame(0x40000005));
    assert.deepEqual(out, { ok: true, reached: 3 });
    assert.equal(calls.broadcast, 1);
  });

  it('rejects WITHOUT broadcasting when no ranged weapon is equipped (DoAttackRange gate)', () => {
    const { deps, calls } = makeDeps({ ok: true, hit: true, damage: 5, killed: false }, false);
    const svc = new RangeAttackService(deps);
    const out = svc.attack(player, frame(0x40000005));
    assert.deepEqual(out, { ok: false, reason: 'no_ranged_weapon' });
    assert.equal(calls.broadcast, 0, 'no swing broadcast on a spoofed range attack');
    assert.equal(calls.resolved.length, 0, 'no damage resolved on a spoofed range attack');
  });

  it('rejects WITHOUT broadcasting when no arrow is equipped, and notifies TID 2608', () => {
    const { deps, calls } = makeDeps({ ok: true, hit: true, damage: 5, killed: false }, true, false);
    const svc = new RangeAttackService(deps);
    const out = svc.attack(player, frame(0x40000005));
    assert.deepEqual(out, { ok: false, reason: 'no_arrow' });
    assert.equal(calls.broadcast, 0);
    assert.equal(calls.resolved.length, 0);
    assert.deepEqual(calls.notified, [TID_TIP_NEEDSATTACKITEM]);
    assert.deepEqual(calls.burned, [], 'nothing burned on a refused shot');
  });

  it('burns exactly one arrow, AFTER the swing broadcast (ArrowDown follows AddRangeAttack)', () => {
    const { deps, calls } = makeDeps({ ok: true, hit: true, damage: 5, killed: false }, true, true);
    const svc = new RangeAttackService(deps);
    const out = svc.attack(player, frame(0x40000005));
    assert.deepEqual(out, { ok: true, reached: 3 });
    assert.deepEqual(calls.burned, [1]);
    assert.deepEqual(calls.order, ['broadcast', 'arrowDown']);
    assert.deepEqual(calls.notified, []);
  });
});
