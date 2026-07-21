import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ResourceIndex, ZoneIndex } from '@flyff/resources';
import { SpawnManager } from '../../src/managers/spawn.manager.js';

/** Build a minimal in-memory resource index for spawn-wiring tests. */
function makeResources(): ResourceIndex {
  const movers = new Map<number, any>();
  movers.set(1006, {
    id: 1006, name: 'Homeit', name_id: 'NPC_HOMEIT', model: 'mdl_npc_homeit.o3d',
    dwObjIndex: 12, scale: 1.0, type: 'npc', level: 1, hp: 1000, mp: 1000, fp: 1000,
    attack: 0, defense: 0, attack_rate: 0, dodge_rate: 0, speed: 0, attack_speed: 0,
    flyable: false, boss: false, giant: false, raid: false, attackable: false, guard: false,
    belligerence: 1, // BELLI_PEACEFUL — suppresses client attack cursor
    outfit: {
      characterKey: 'MaDa_Homeit', hairMesh: 1, hairColor: 0xff0000ff, headMesh: 3,
      equip: [{ parts: 2, itemId: 1029 }],
    },
  });
  movers.set(1, {
    id: 1, name: 'Guard', name_id: 'MOVER_GUARD', model: 'mdl_guard.o3d',
    dwObjIndex: 20, scale: 1.0, type: 'monster', level: 80, hp: 50000, mp: 10, fp: 10,
    attack: 7000, defense: 300, attack_rate: 150, dodge_rate: 10, speed: 1, attack_speed: 1,
    flyable: false, boss: false, giant: false, raid: false, attackable: true, guard: true,
    belligerence: 12, // BELLI_MELEE — aggressive
  });

  const flaris = {
    _version: '1.0', _id: 'flaris', _id_numeric: 1, name: 'Flaris', name_id: 'ZONE_FLARIS',
    world_id: 'madrigal',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    revival: { position: { x: 0, y: 0, z: 0 }, radius: 1 },
    portals: [],
    npcs: [
      { id: 1, mover_id: 1006, position: { x: 7000, y: 100, z: 3300 }, angle: 0, functions: [] },
    ],
    spawns: [
      { id: 1, mover_id: 1, position: { x: 6900, y: 100, z: 3300 }, radius: 10, count: 2, delay: 5000 },
    ],
    regions: [],
  };
  const zones: ZoneIndex = {
    zones: new Map([['flaris', flaris as never]]),
    byNumericId: new Map([[1, flaris as never]]),
    byWorld: new Map([['madrigal', [flaris as never]]]),
  };
  return {
    items: { items: new Map(), byName: new Map(), byKind: new Map() },
    movers: { movers, byName: new Map(), byType: new Map() },
    skills: { skills: new Map(), byName: new Map(), byJob: new Map() },
    zones,
  } as unknown as ResourceIndex;
}

describe('SpawnManager', () => {
  it('materializes zone NPCs + monster spawn counts from resources', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    // 1 NPC + 2 monsters (count=2)
    assert.equal(mgr.size, 3);
    const flaris = mgr.inZone(1);
    assert.equal(flaris.length, 3);
    assert.ok(flaris.every((m) => m.m_nZoneId === 1));
  });

  it('assigns ascending objids from 0x40000000, disjoint from player char ids', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    assert.equal(mgr.get(0x40000000)?.m_idMover, 0x40000000);
    assert.ok(mgr.inZone(1).every((m) => m.m_idMover >= 0x40000000));
  });

  it('carries the NPC outfit (characterKey + equip) onto the spawned entity', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12);
    assert.ok(homeit, 'equipped NPC spawned');
    assert.equal(homeit!.outfit?.characterKey, 'MaDa_Homeit');
    assert.equal(homeit!.outfit?.hairColor, 0xff0000ff);
    assert.deepEqual(homeit!.outfit?.equip, [{ parts: 2, itemId: 1029 }]);
  });

  it('monsters spawn naked (no outfit)', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const aibat = mgr.inZone(1).find((m) => m.m_dwIndex === 20);
    assert.ok(aibat, 'monster spawned');
    assert.equal(aibat!.outfit, undefined);
  });

  it('propagates attackable + guard flags from the mover definition', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const guard = mgr.inZone(1).find((m) => m.m_dwIndex === 20);
    assert.ok(guard, 'guard monster spawned');
    assert.equal(guard!.m_bAttackable, true, 'guard is attackable');
    assert.equal(guard!.m_bGuard, true, 'guard flag carried through');

    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12);
    assert.ok(homeit, 'NPC spawned');
    assert.equal(homeit!.m_bAttackable, false, 'peaceful NPC is non-attackable');
    assert.equal(homeit!.m_bGuard, false);
  });

  it('propagates m_dwBelligerence from the mover definition (peaceful vs aggressive)', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12);
    assert.ok(homeit, 'NPC spawned');
    assert.equal(homeit!.m_dwBelligerence, 1, 'peaceful NPC carries BELLI_PEACEFUL');

    const guard = mgr.inZone(1).find((m) => m.m_dwIndex === 20);
    assert.ok(guard, 'guard monster spawned');
    assert.equal(guard!.m_dwBelligerence, 12, 'aggressive monster carries BELLI_MELEE');
  });

  it('does not allocate any id until bootstrap runs', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    assert.equal(mgr.size, 0);
    assert.equal(mgr.inZone(1).length, 0);
  });

  it('spreads the count monsters of a spawn across distinct positions (no stacking)', () => {
    // Bump the fixture spawn count so multiple instances materialize.
    const resources = makeResources();
    const flaris = resources.zones.zones.get('flaris') as never as { spawns: Array<{ count: number; radius: number; position: { x: number; y: number; z: number } }> };
    flaris.spawns[0]!.count = 8;
    flaris.spawns[0]!.radius = 40;
    const mgr = new SpawnManager({ resources });
    mgr.bootstrap();

    const guards = mgr.inZone(1).filter((m) => m.m_dwIndex === 20);
    assert.equal(guards.length, 8);
    const positions = new Set(guards.map((m) => `${m.m_vPos.x.toFixed(3)},${m.m_vPos.z.toFixed(3)}`));
    assert.equal(positions.size, 8, 'each monster on a distinct position');
    // Every offset within the spawn radius (sunflower keeps r ≤ radius*0.5).
    const { x, z } = flaris.spawns[0]!.position;
    for (const m of guards) {
      const dx = m.m_vPos.x - x;
      const dz = m.m_vPos.z - z;
      assert.ok(dx * dx + dz * dz <= 40 * 40, 'inside spawn radius');
    }
  });

  it('kill() removes the mover immediately (no respawn for static NPCs)', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();
    const before = mgr.size;
    // Kill the peaceful NPC (delayMs=0) → no respawn scheduled, mover gone now.
    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12)!;
    assert.equal(mgr.kill(homeit.m_idMover), true);
    assert.equal(mgr.get(homeit.m_idMover), undefined);
    assert.equal(mgr.size, before - 1);
    assert.equal(mgr.kill(homeit.m_idMover), false); // already gone
  });

  it('kill() schedules a respawn after spawn.delay; onSpawn fires with a fresh mover', () => {
    mock.timers.enable();
    const spawned: number[] = [];
    const mgr = new SpawnManager({
      resources: makeResources(),
      onSpawn: (m) => spawned.push(m.m_idMover),
    });
    mgr.bootstrap();

    // Fixture spawn: Guard (MI 20), count=2, delay=5000ms.
    const guards = mgr.inZone(1).filter((m) => m.m_dwIndex === 20);
    assert.equal(guards.length, 2);
    const victim = guards[0]!;
    const originalId = victim.m_idMover;
    const originalHp = victim.m_nHitPoint;

    assert.equal(mgr.kill(victim.m_idMover), true);
    assert.equal(mgr.get(originalId), undefined);
    assert.equal(spawned.length, 0); // not yet — timer pending

    mock.timers.tick(5001);

    assert.equal(spawned.length, 1);
    const replacement = mgr.get(spawned[0]!);
    assert.ok(replacement, 'respawned mover is live');
    assert.notEqual(replacement!.m_idMover, originalId, 'new objid');
    assert.equal(replacement!.m_dwIndex, 20, 'same model index');
    assert.equal(replacement!.m_nHitPoint, originalHp, 'full HP on respawn');
    assert.equal(replacement!.m_bDead, false, 'death flag reset');

    // The replacement is itself respawnable.
    const secondId = replacement!.m_idMover;
    mgr.kill(secondId);
    mock.timers.tick(5001);
    assert.equal(spawned.length, 2);
    assert.notEqual(spawned[1]!, secondId);
    mock.restoreAll();
  });
});
