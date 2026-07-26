import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { VicinityService } from '../../src/services/vicinity.service';
import { MINIMAP_VIEW_RADIUS } from '@flyff/world-core';
import type { CMover, CPlayer, Vec3 } from '@flyff/entities';

/** Minimal mover stub -- vicinity only reads m_vPos for the radius filter. */
function mover(id: number, pos: Vec3): CMover {
  return { m_idMover: id, m_vPos: pos } as unknown as CMover;
}

function makeDeps(player: CPlayer | null, movers: CMover[]) {
  let built: CMover[] | null = null;
  return {
    built: (): CMover[] | null => built,
    deps: {
      playerManager: { get: (): CPlayer | null => player },
      spawnManager: { inZone: (): CMover[] => movers },
      npcSnapshotSerializer: {
        build: (m: CMover[]): Buffer => { built = m; return Buffer.from([0x01]); },
      },
    } as never,
  };
}

describe('VicinityService', () => {
  it('keeps movers within MINIMAP_VIEW_RADIUS and drops the rest', () => {
    const player = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 }, m_vicinitySent: false } as unknown as CPlayer;
    const near = mover(1, { x: 100, y: 0, z: 100 });              // dist ~141 <= 256
    const edge = mover(2, { x: MINIMAP_VIEW_RADIUS, y: 0, z: 0 }); // dist 256 == radius (<=)
    const far = mover(3, { x: 3000, y: 0, z: 0 });                // dist 3000 >> 256 (off-HUD)
    const h = makeDeps(player, [near, edge, far]);
    const svc = new VicinityService(h.deps);

    const res = svc.enterZone(42);

    assert.deepEqual(res, { snapshot: Buffer.from([0x01]) });
    const ids = h.built()!.map((m) => m.m_idMover);
    assert.deepEqual(ids, [1, 2]);
  });

  it('uses ground-plane distance (x/z), ignoring y', () => {
    const player = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 }, m_vicinitySent: false } as unknown as CPlayer;
    // Same x/z as player but huge y -- ground-plane distance is 0, must be kept.
    const sameColumn = mover(9, { x: 0, y: 9999, z: 0 });
    const h = makeDeps(player, [sameColumn]);
    const svc = new VicinityService(h.deps);

    const res = svc.enterZone(42);

    assert.deepEqual(res, { snapshot: Buffer.from([0x01]) });
    assert.deepEqual(h.built()!.map((m) => m.m_idMover), [9]);
  });

  it('returns null when every mover is outside the radius (nothing to draw)', () => {
    const player = { m_nZoneId: 1, m_vPos: { x: 7000, y: 0, z: 3300 }, m_vicinitySent: false } as unknown as CPlayer;
    const farMonsters = [mover(1, { x: 3000, y: 0, z: 2500 })]; // ~4000 units away
    const h = makeDeps(player, farMonsters);
    const svc = new VicinityService(h.deps);

    assert.equal(svc.enterZone(42), null);
    assert.equal(h.built(), null);
  });

  it('is one-shot: a second enterZone returns null even if movers exist', () => {
    const player = { m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 }, m_vicinitySent: false } as unknown as CPlayer;
    const h = makeDeps(player, [mover(1, { x: 10, y: 0, z: 10 })]);
    const svc = new VicinityService(h.deps);

    assert.ok(svc.enterZone(42) !== null);
    assert.equal(svc.enterZone(42), null);
  });

  it('reports no_player when the player is unknown (session desync)', () => {
    const h = makeDeps(null, [mover(1, { x: 0, y: 0, z: 0 })]);
    const svc = new VicinityService(h.deps);
    assert.deepEqual(svc.enterZone(42), { ok: false, reason: 'no_player' });
  });

  describe('resendAt', () => {
    it('bypasses the one-shot guard (re-emits after enterZone already fired)', () => {
      const player = {
        m_idPlayer: 42, m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 }, m_vicinitySent: true,
      } as unknown as CPlayer;
      const h = makeDeps(player, [mover(1, { x: 10, y: 0, z: 10 })]);
      const svc = new VicinityService(h.deps);

      // enterZone is blocked by the one-shot, but resendAt must still emit.
      assert.equal(svc.enterZone(42), null);
      assert.deepEqual(svc.resendAt(42), { snapshot: Buffer.from([0x01]) });
      assert.deepEqual(h.built()!.map((m) => m.m_idMover), [1]);
    });

    it('returns null when no player exists', () => {
      const h = makeDeps(null, [mover(1, { x: 0, y: 0, z: 0 })]);
      const svc = new VicinityService(h.deps);
      assert.equal(svc.resendAt(42), null);
    });

    it('returns null when the new position has no movers in radius', () => {
      const player = {
        m_idPlayer: 42, m_nZoneId: 1, m_vPos: { x: 9000, y: 0, z: 9000 }, m_vicinitySent: true,
      } as unknown as CPlayer;
      const h = makeDeps(player, [mover(1, { x: 0, y: 0, z: 0 })]);
      const svc = new VicinityService(h.deps);
      assert.equal(svc.resendAt(42), null);
    });
  });
});
