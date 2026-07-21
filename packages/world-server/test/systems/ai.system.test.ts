import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import type { SpawnManager } from '../../src/managers/spawn.manager.js';
import type { ZoneManager } from '../../src/managers/zone.manager.js';
import { CMover } from '../../src/entities/mover.js';
import type { MoverSpawnSource } from '../../src/entities/mover.js';
import type { Vec3 } from '../../src/entities/player.js';
import { AISystem } from '../../src/systems/ai.system.js';

/** Captured broadcast: the unframed DESTPOS buffer + the filter args. */
interface Cast {
  pos: Vec3;
  zoneId: number;
  packet: Buffer;
}

/** Minimal mover source for an aggressive wandering monster. */
function monsterSrc(): MoverSpawnSource {
  return {
    modelIndex: 20, name: 'Aibatt', level: 1, hp: 100,
    attackable: true, guard: false, belligerence: 12,
  };
}

/** Spawn a mover at `pos` (anchor = pos) in zone 1. */
function makeMover(id: number, pos: Vec3): CMover {
  const m = CMover.spawn(id, monsterSrc(), pos, 1);
  return m;
}

/** ZoneManager stub that records every broadcastAround call. */
function makeZone(casts: Cast[]): ZoneManager {
  return {
    broadcastAround(pos: Vec3, zoneId: number, _r: number, packet: Buffer): number {
      casts.push({ pos: { ...pos }, zoneId, packet });
      return 1;
    },
  } as unknown as ZoneManager;
}

/** SpawnManager stub yielding a fixed live-mover list. */
function makeSpawn(movers: CMover[]): SpawnManager {
  return { all: function* () { yield* movers; } } as unknown as SpawnManager;
}

/** Parse objid + dest (x,z) out of a raw DESTPOS payload built by DestPosSerializer. */
function parseDest(buf: Buffer): { objid: number; x: number; z: number } {
  return {
    objid: buf.readUInt32LE(10),
    x: buf.readFloatLE(16),
    z: buf.readFloatLE(24),
  };
}

describe('AISystem (idle wander)', () => {
  it('stagger-seeds m_tmNextWander on first tick and emits no broadcast', () => {
    const casts: Cast[] = [];
    const m = makeMover(0x40000000, { x: 1000, y: 0, z: 1000 });
    assert.equal(m.m_tmNextWander, 0);
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts) });
    ai.tick(10_000);
    assert.equal(casts.length, 0, 'no broadcast on stagger seed');
    assert.ok(m.m_tmNextWander > 10_000 && m.m_tmNextWander <= 10_000 + 5000);
  });

  it('picks a dest within the ±10 wander box and broadcasts DESTPOS', () => {
    const casts: Cast[] = [];
    const m = makeMover(0x40000001, { x: 1000, y: 0, z: 1000 });
    m.m_tmNextWander = 1000; // due now
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts) });
    ai.tick(1000);
    assert.equal(casts.length, 1);
    const d = parseDest(casts[0]!.packet);
    assert.equal(d.objid, m.m_idMover);
    assert.ok(d.x >= 990 && d.x <= 1010, `x=${d.x} inside ±10 box`);
    assert.ok(d.z >= 990 && d.z <= 1010, `z=${d.z} inside ±10 box`);
    // 5–6 s until next pick.
    assert.ok(m.m_tmNextWander >= 1000 + 5000 && m.m_tmNextWander <= 1000 + 6000);
    // Server logical pos snapped to the broadcast dest.
    assert.equal(m.m_vPos.x, d.x);
    assert.equal(m.m_vPos.z, d.z);
  });

  it('skips a pick that would leave the 30 m leash (no broadcast, next wander set)', () => {
    const casts: Cast[] = [];
    // Anchor far from origin; place monster at the leash edge so any +10 box
    // pick outward exceeds RANGE_MOVE while the monster itself stays inside.
    const anchor: Vec3 = { x: 0, y: 0, z: 0 };
    const m = makeMover(0x40000002, anchor);
    m.m_vPos = { x: 29, y: 0, z: 0 }; // inside leash (29 < 30)...
    m.m_tmNextWander = 1000;
    // ...but force every pick outward (+10) so dest exits the leash.
    mock.method(Math, 'random', () => 0.9999);
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts) });
    ai.tick(1000);
    assert.equal(casts.length, 0, 'outward pick suppressed');
    assert.ok(m.m_tmNextWander > 1000, 'next wander rescheduled');
    mock.restoreAll();
  });

  it('snaps home + broadcasts when already outside the leash', () => {
    const casts: Cast[] = [];
    const anchor: Vec3 = { x: 500, y: 0, z: 500 };
    const m = makeMover(0x40000003, anchor);
    m.m_vPos = { x: 600, y: 0, z: 600 }; // 141 m from anchor — well outside
    m.m_tmNextWander = 1000;
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts) });
    ai.tick(1000);
    assert.equal(casts.length, 1);
    const d = parseDest(casts[0]!.packet);
    assert.equal(d.x, 500, 'dest = home x');
    assert.equal(d.z, 500, 'dest = home z');
    assert.equal(m.m_vPos.x, 500);
    assert.equal(m.m_vPos.z, 500);
  });

  it('keeps every random pick inside the 30 m leash over many ticks', () => {
    const casts: Cast[] = [];
    const anchor: Vec3 = { x: 1000, y: 0, z: 1000 };
    const m = makeMover(0x40000004, anchor);
    m.m_tmNextWander = 0;
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts) });
    // Drive 50 picks with real randomness.
    let now = 0;
    for (let i = 0; i < 50; i++) {
      now = m.m_tmNextWander || now + 6000;
      ai.tick(now);
    }
    const dx = m.m_vPos.x - anchor.x;
    const dz = m.m_vPos.z - anchor.z;
    assert.ok(dx * dx + dz * dz <= 30 * 30, `stayed inside leash (dx=${dx}, dz=${dz})`);
    assert.ok(casts.length > 0, 'wandered at least once');
  });

  it('skips peaceful NPCs, guards, and dead movers', () => {
    const casts: Cast[] = [];
    const peaceful = makeMover(0x40000010, { x: 0, y: 0, z: 0 });
    peaceful.m_bAttackable = false;
    peaceful.m_tmNextWander = 1;
    const guard = makeMover(0x40000011, { x: 0, y: 0, z: 0 });
    guard.m_bGuard = true;
    guard.m_tmNextWander = 1;
    const dead = makeMover(0x40000012, { x: 0, y: 0, z: 0 });
    dead.m_bDead = true;
    dead.m_tmNextWander = 1;
    const live = makeMover(0x40000013, { x: 0, y: 0, z: 0 });
    live.m_tmNextWander = 1;
    const ai = new AISystem({
      spawnManager: makeSpawn([peaceful, guard, dead, live]),
      zoneManager: makeZone(casts),
    });
    ai.tick(1000);
    // Only the live monster broadcasts.
    assert.equal(casts.length, 1);
    assert.equal(parseDest(casts[0]!.packet).objid, live.m_idMover);
  });

  it('start/stop controls the timer without throwing', () => {
    const ai = new AISystem({ spawnManager: makeSpawn([]), zoneManager: makeZone([]) });
    ai.start();
    ai.start(); // idempotent
    ai.stop();
    ai.stop(); // idempotent
    assert.ok(true);
  });
});
