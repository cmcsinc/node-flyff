import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ResourceIndex, ZoneIndex } from '@flyff/resources';
import { SpawnManager, CORPSE_DESPAWN_MS } from '@flyff/world-core';
import { CMover } from '@flyff/entities';

/** Build a minimal in-memory resource index for spawn-wiring tests. */
function makeResources(): ResourceIndex {
  const movers = new Map<number, any>();
  movers.set(1006, {
    id: 1006, key: 'MI_MADA_HOMEIT', name: 'Homeit', name_id: 'NPC_HOMEIT', model: 'mdl_npc_homeit.o3d',
    dwObjIndex: 12, scale: 1.0, type: 'npc', level: 1, hp: 1000, mp: 1000, fp: 1000,
    attack: 0, defense: 0, attack_rate: 0, dodge_rate: 0, speed: 0, attack_speed: 0,
    flyable: false, boss: false, giant: false, raid: false, attackable: false, guard: false,
    belligerence: 1, // BELLI_PEACEFUL -- suppresses client attack cursor
    outfit: {
      characterKey: 'MaDa_Homeit', hairMesh: 1, hairColor: 0xff0000ff, headMesh: 3,
      equip: [{ parts: 2, itemId: 1029 }],
    },
  });
  movers.set(1, {
    id: 1, name: 'Guard', name_id: 'MOVER_GUARD', model: 'mdl_guard.o3d',
    dwObjIndex: 20, scale: 1.0, type: 'monster', level: 80, hp: 50000, mp: 10, fp: 10,
    attack: 7000, defense: 300, attack_rate: 150, dodge_rate: 10, speed: 1, attack_speed: 1500,
    attack_range: 5,
    flyable: false, boss: false, giant: false, raid: false, attackable: true, guard: true,
    belligerence: 12, // BELLI_MELEE -- aggressive
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
    items: { items: new Map(), byName: new Map(), byKind: new Map(), byKind3: new Map(), definedIds: new Set([81, 83, 413]) },
    movers: { movers, byName: new Map(), byType: new Map() },
    skills: { skills: new Map(), byName: new Map(), byJob: new Map() },
    zones,
    characterInc: {
      byKey: new Map([['MaDa_Homeit', {
        key: 'MaDa_Homeit',
        menus: [0, 2],
        hasDialog: true,
        outfit: {
          characterKey: 'MaDa_Homeit', hairMesh: 1, hairColor: 0xff0000ff, headMesh: 3,
          equip: [{ parts: 0, itemId: 1029 }],
        },
        dialogFile: 'MaDa_Homeit.txt',
        vendorTabs: [],
        vendorItems: [],
        vendorItemIds: [],
        venderType: undefined,
        vendorSlotCount: 0,
      }]]),
      byStem: new Map([['mada_homeit', {
        key: 'MaDa_Homeit',
        menus: [0, 2],
        hasDialog: true,
        outfit: {
          characterKey: 'MaDa_Homeit', hairMesh: 1, hairColor: 0xff0000ff, headMesh: 3,
          equip: [{ parts: 0, itemId: 1029 }],
        },
        dialogFile: 'MaDa_Homeit.txt',
        vendorTabs: [],
        vendorItems: [],
        vendorItemIds: [],
        venderType: undefined,
        vendorSlotCount: 0,
      }]]),
    },
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

  it('skips NPC placements that resolve to a monster-type mover (MaFl_Demian case)', () => {
    const resources = makeResources();
    const flaris = resources.zones.zones.get('flaris') as never as {
      npcs: Array<{ id: number; mover_id: number; position: { x: number; y: number; z: number }; angle: number; functions: never[] }>;
    };
    // mover_id 1 is type 'monster'. As an NPC placement this is the MaFl_Demian
    // pattern (quest NPC reusing a monster model); it must NOT materialize as
    // an attackable monster in town. Baseline fixture is 1 NPC + 2 monsters = 3.
    flaris.npcs.push({ id: 2, mover_id: 1, position: { x: 7100, y: 100, z: 3300 }, angle: 0, functions: [] });
    const mgr = new SpawnManager({ resources });
    mgr.bootstrap();

    assert.equal(mgr.size, 3, 'monster-type NPC placement contributes 0, not 1');
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
    // character.inc outfit (parts=0) overrides the mover-yml fixture (parts=2)
    // -- canonical source wins per `toOutfit(def, charBlock)`.
    assert.deepEqual(homeit!.outfit?.equip, [{ parts: 0, itemId: 1029 }]);
  });

  it('propagates m_abMoverMenu from the character.inc block (MMI_DIALOG etc.)', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12);
    assert.ok(homeit);
    assert.deepEqual([...homeit!.m_abMoverMenu], [0, 2], 'MMI_DIALOG + MMI_TRADE propagated');
    // characterKey decoupled from outfit -- the client needs it to resolve
    // m_abMoverMenu even when SetFigure/SetEquip are absent.
    assert.equal(homeit!.m_szCharacterKey, 'MaDa_Homeit', 'characterKey propagated for client CNpcProperty lookup');
  });

  it('monsters spawn naked (no outfit)', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const aibat = mgr.inZone(1).find((m) => m.m_dwIndex === 20);
    assert.ok(aibat, 'monster spawned');
    assert.equal(aibat!.outfit, undefined);
  });

  it('resolves vendor stock onto the mover from character.inc + item index', () => {
    const resources = makeResources();
    // Two IK3_AXE weapons -- intentionally unsorted so the resolver's level_req
    // ascending sort is exercised (id 83 has the higher level_req).
    (resources.items.items as Map<number, { id: number; level_req: number }>).set(81, { id: 81, level_req: 1 });
    (resources.items.items as Map<number, { id: number; level_req: number }>).set(83, { id: 83, level_req: 5 });
    (resources.items.byKind3 as Map<string, Array<{ id: number; level_req: number }>>).set('IK3_AXE', [
      { id: 83, level_req: 5 },
      { id: 81, level_req: 1 },
    ]);
    for (const [k, map] of [['MaDa_Homeit', resources.characterInc.byKey], ['mada_homeit', resources.characterInc.byStem]] as const) {
      const blk = (map as Map<string, { vendorItems: unknown[]; vendorItemIds: unknown[] }>).get(k)!;
      blk.vendorItems = [
        { slot: 0, itemKind3Symbol: 'IK3_AXE', totalNum: 2 },
      ];
      blk.vendorItemIds = [{ slot: 1, itemId: 413 }];
    }
    const mgr = new SpawnManager({ resources });
    mgr.bootstrap();

    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12)!;
    assert.ok(homeit, 'vendor NPC spawned');
    // Tab 0: category expansion -- sorted by level_req asc, capped at totalNum(2).
    assert.equal(homeit.m_vendorStock[0]![0]!.itemId, 81, 'lowest-level IK3_AXE first');
    assert.equal(homeit.m_vendorStock[0]![1]!.itemId, 83, 'next IK3_AXE');
    // Tab 1: explicit AddVendorItem2 id placed directly.
    assert.equal(homeit.m_vendorStock[1]![0]!.itemId, 413, 'explicit id in tab 1');
    // Tabs 2-3 left empty (all null).
    assert.equal(homeit.m_vendorStock[2]!.every((s) => s === null), true, 'tab 2 empty');
  });

  it('resolves the character.inc block by placement character_key, not mover MI (shared-model NPCs)', () => {
    // Boboku (weapons) + Boboko (armor) share mover model MI 211 but are distinct
    // character.inc blocks. The .dyo tags each placement with m_szCharacterKey;
    // C++ CMover::GetCharacter looks up by that key (Mover.cpp:962), not model.
    const resources = makeResources();
    (resources.movers.movers as Map<number, unknown>).set(211, {
      id: 211, key: 'MI_MAFL_BOBOKU', name: 'Boboku', name_id: 'NPC_BOBOKU',
      dwObjIndex: 211, scale: 1.0, type: 'npc', level: 1, hp: 1000, mp: 0, fp: 0,
      attack: 0, defense: 0, attack_rate: 0, dodge_rate: 0, speed: 0, attack_speed: 0,
      flyable: false, boss: false, giant: false, raid: false, attackable: false, guard: false,
      belligerence: 1,
    });
    (resources.items.items as Map<number, { id: number; level_req: number }>).set(700, { id: 700, level_req: 15 });
    (resources.items.items as Map<number, { id: number; level_req: number }>).set(900, { id: 900, level_req: 15 });
    (resources.items.definedIds as Set<number>).add(700);
    (resources.items.definedIds as Set<number>).add(900);
    (resources.items.byKind3 as Map<string, Array<{ id: number; level_req: number }>>).set('IK3_SWD', [{ id: 700, level_req: 15 }]);
    (resources.items.byKind3 as Map<string, Array<{ id: number; level_req: number }>>).set('IK3_SUIT', [{ id: 900, level_req: 15 }]);
    const block = (key: string, ik3: string): unknown => ({
      key, menus: [0, 2], hasDialog: true, outfit: undefined, dialogFile: `${key}.txt`,
      vendorTabs: [], vendorItems: [{ slot: 0, itemKind3Symbol: ik3, totalNum: 1 }],
      vendorItemIds: [], venderType: undefined, vendorSlotCount: 0,
    });
    (resources.characterInc.byKey as Map<string, unknown>).set('MaFl_Boboku', block('MaFl_Boboku', 'IK3_SWD'));
    (resources.characterInc.byKey as Map<string, unknown>).set('MaFl_Boboko', block('MaFl_Boboko', 'IK3_SUIT'));
    // byStem intentionally NOT set for these keys -- proves resolution used the
    // character_key (byKey), not the MI-key fallback (which would hit byStem).
    const flaris = resources.zones.zones.get('flaris') as never as {
      npcs: Array<{ id: number; mover_id: number; character_key?: string; position: { x: number; y: number; z: number }; angle: number; functions: never[] }>;
    };
    flaris.npcs.push({ id: 50, mover_id: 211, character_key: 'MaFl_Boboku', position: { x: 6926, y: 100, z: 3232 }, angle: 0, functions: [] });
    flaris.npcs.push({ id: 51, mover_id: 211, character_key: 'MaFl_Boboko', position: { x: 6927, y: 100, z: 3228 }, angle: 0, functions: [] });

    const mgr = new SpawnManager({ resources });
    mgr.bootstrap();

    const boboku = mgr.inZone(1).find((m) => m.m_szCharacterKey === 'MaFl_Boboku');
    const boboko = mgr.inZone(1).find((m) => m.m_szCharacterKey === 'MaFl_Boboko');
    assert.ok(boboku, 'Boboku spawned under its own character_key');
    assert.ok(boboko, 'Boboko spawned under its own character_key');
    assert.equal(boboku!.m_vendorStock[0]![0]!.itemId, 700, 'Boboku tab 0 = IK3_SWD weapon');
    assert.equal(boboko!.m_vendorStock[0]![0]!.itemId, 900, 'Boboko tab 0 = IK3_SUIT armor, not weapons');
    assert.notEqual(boboku!.m_idMover, boboko!.m_idMover, 'two distinct movers');
  });

  it('defaults a vendor-less NPC to the empty vendor stock', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();
    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12)!;
    assert.equal(homeit.m_vendorStock.length, 4, '4 tabs');
    assert.equal(homeit.m_vendorStock[0]!.every((s) => s === null), true, 'tab 0 empty');
  });

  it('propagates attackable + guard flags from the mover definition', () => {
    const mgr = new SpawnManager({ resources: makeResources() });
    mgr.bootstrap();

    const guard = mgr.inZone(1).find((m) => m.m_dwIndex === 20);
    assert.ok(guard, 'guard monster spawned');
    assert.equal(guard!.m_bAttackable, true, 'guard is attackable');
    assert.equal(guard!.m_bGuard, true, 'guard flag carried through');
    // attack_range (5) + attack_speed (1500) thread onto the entity; belli 12 = melee.
    assert.equal(guard!.m_nAttackRange, 5, 'attack_range threaded');
    assert.equal(guard!.m_nReAttackDelay, 1500, 'attack_speed threaded as re-attack delay');
    assert.equal(guard!.m_bRangeAttack, false, 'BELLI_MELEE is not ranged');

    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12);
    assert.ok(homeit, 'NPC spawned');
    assert.equal(homeit!.m_bAttackable, false, 'peaceful NPC is non-attackable');
    assert.equal(homeit!.m_bGuard, false);
  });

  it('flags ranged + default range distance for BELLI_RANGE belligerence (7/10/13)', () => {
    const ranges: Array<[number, number]> = [[7, 10], [10, 10], [13, 12]];
    for (const [belli, attackRange] of ranges) {
      const m = CMover.spawn(
        0x40000040,
        { modelIndex: 99, name: 'R', level: 1, hp: 10, attackable: true, belligerence: belli, attackRange },
        { x: 0, y: 0, z: 0 }, 1,
      );
      assert.equal(m.m_bRangeAttack, true, `belli ${belli} -> ranged`);
      assert.equal(m.m_nAttackRange, attackRange, `belli ${belli} -> attack range ${attackRange}`);
    }
    // Default range distance when attack_range omitted = AR_RANGE (10 m).
    const defaulted = CMover.spawn(
      0x40000041,
      { modelIndex: 99, name: 'R', level: 1, hp: 10, attackable: true, belligerence: 13 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    assert.equal(defaulted.m_nAttackRange, 10, 'omitted attack_range defaults to AR_RANGE');
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
    // Every offset within the spawn radius (sunflower keeps r <= radius*0.5).
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
    // Kill the peaceful NPC (delayMs=0) -> no respawn scheduled, mover gone now.
    const homeit = mgr.inZone(1).find((m) => m.m_dwIndex === 12)!;
    assert.equal(mgr.kill(homeit.m_idMover), true);
    assert.equal(mgr.get(homeit.m_idMover), undefined);
    assert.equal(mgr.size, before - 1);
    assert.equal(mgr.kill(homeit.m_idMover), false); // already gone
  });

  // Mock timers are session-global (enable() throws if already enabled, reset()
  // disables), so each timer test re-enables here and resets after.
  describe('timers', () => {
    beforeEach(() => mock.timers.enable());
    afterEach(() => mock.timers.reset());

    it('kill() schedules a respawn after spawn.delay; onSpawn fires with a fresh mover', () => {
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
      assert.equal(spawned.length, 0); // not yet -- timer pending

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
    });

    it('kill(id, { despawn: true }) fires onDespawn after CORPSE_DESPAWN_MS', () => {
      const despawned: number[] = [];
      const mgr = new SpawnManager({
        resources: makeResources(),
        onDespawn: (m) => despawned.push(m.m_idMover),
      });
      mgr.bootstrap();

      const guards = mgr.inZone(1).filter((m) => m.m_dwIndex === 20);
      const victimId = guards[0]!.m_idMover;

      assert.equal(mgr.kill(victimId, { despawn: true }), true);
      assert.equal(mgr.get(victimId), undefined); // removed from live table immediately
      assert.equal(despawned.length, 0); // corpse timer pending

      mock.timers.tick(CORPSE_DESPAWN_MS + 1);

      assert.equal(despawned.length, 1);
      assert.equal(despawned[0], victimId);
    });

    it('kill(id) without despawn flag never fires onDespawn', () => {
      const despawned: number[] = [];
      const mgr = new SpawnManager({
        resources: makeResources(),
        onDespawn: (m) => despawned.push(m.m_idMover),
      });
      mgr.bootstrap();

      const victimId = mgr.inZone(1).find((m) => m.m_dwIndex === 12)!.m_idMover;
      mgr.kill(victimId); // admin path -- no despawn

      mock.timers.tick(CORPSE_DESPAWN_MS + 1);
      assert.equal(despawned.length, 0); // /rn-style kill does its own DEL_OBJ
    });
  });

  // C++ CWorld::IsUsableDYO / IsUsableDYO2 (WorldFile.cpp:1109, :1181) -- retail
  // drops these placements at world load. Unported, ~177 hidden Flaris blocks
  // spawned and visually stacked on the live NPCs.
  describe('IsUsableDYO placement gate', () => {
    /** Push an NPC placement onto flaris and return its resources. */
    function withNpc(key: string, block: unknown): ResourceIndex {
      const resources = makeResources();
      if (block !== undefined) {
        (resources.characterInc.byKey as Map<string, unknown>).set(key, block);
      }
      const flaris = resources.zones.zones.get('flaris') as never as {
        npcs: Array<Record<string, unknown>>;
      };
      flaris.npcs.push({
        id: 60, mover_id: 1006, character_key: key,
        position: { x: 7100, y: 100, z: 3200 }, angle: 0, functions: [],
      });
      return resources;
    }

    const blk = (key: string, output: boolean, langs: readonly string[] = []): unknown => ({
      key, menus: [], hasDialog: false, outfit: undefined, dialogFile: undefined,
      vendorTabs: [], vendorItems: [], vendorItemIds: [], venderType: undefined,
      vendorSlotCount: 0, output, langs,
    });

    it('skips a placement whose character block has SetOutput(FALSE)', () => {
      const mgr = new SpawnManager({ resources: withNpc('MaEw_Mewrang', blk('MaEw_Mewrang', false)) });
      mgr.bootstrap();
      assert.equal(mgr.inZone(1).some((m) => m.m_szCharacterKey === 'MaEw_Mewrang'), false);
    });

    it('spawns a placement whose character block has SetOutput(TRUE)', () => {
      const mgr = new SpawnManager({ resources: withNpc('MaFl_Zandark', blk('MaFl_Zandark', true)) });
      mgr.bootstrap();
      assert.equal(mgr.inZone(1).some((m) => m.m_szCharacterKey === 'MaFl_Zandark'), true);
    });

    it('judges a SetLang block on bOutput alone (language half deliberately unported)', () => {
      // MaFl_Devil: SetOutput(FALSE) + every LANG_*. Applying the C++ language
      // flip would resurrect exactly the block retail hides.
      const mgr = new SpawnManager({ resources: withNpc('MaFl_Devil', blk('MaFl_Devil', false, ['LANG_USA'])) });
      mgr.bootstrap();
      assert.equal(mgr.inZone(1).some((m) => m.m_szCharacterKey === 'MaFl_Devil'), false);
    });

    it('skips an event-gated key even when its block says SetOutput(TRUE)', () => {
      // EVE_GUILDCOMBAT is off (no event system) -> IsUsableDYO returns FALSE
      // before it ever consults bOutput.
      const mgr = new SpawnManager({ resources: withNpc('MaFl_GuildWar', blk('MaFl_GuildWar', true)) });
      mgr.bootstrap();
      assert.equal(mgr.inZone(1).some((m) => m.m_szCharacterKey === 'MaFl_GuildWar'), false);
    });

    it('matches event-gated keys case-insensitively (C++ uses stricmp)', () => {
      const mgr = new SpawnManager({ resources: withNpc('mafl_donaris', blk('mafl_donaris', true)) });
      mgr.bootstrap();
      assert.equal(mgr.inZone(1).some((m) => m.m_szCharacterKey === 'mafl_donaris'), false);
    });

    it('keeps a placement with no resolvable character block (no bOutput to consult)', () => {
      // Homeit from the base fixture carries no character_key on its placement;
      // it must still spawn via the MI-key fallback.
      const mgr = new SpawnManager({ resources: makeResources() });
      mgr.bootstrap();
      assert.equal(mgr.inZone(1).some((m) => m.m_dwIndex === 12), true);
    });
  });
});
