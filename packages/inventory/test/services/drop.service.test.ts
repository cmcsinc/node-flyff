/**
 * DropService test -- deterministic rng asserts the percent roll, the single
 * level-difference gate, `maxItem`, stack rolling, rate multipliers, the gold
 * pile, and looter = first-hitter.
 *
 * Two behaviours here are the point of the whole rework and are pinned hard:
 *
 * 1. **The level bucket gates ONCE per kill, not per slot.** The C++ rolls
 *    `xRandom(100) < nProbability * rate` before the slot loop
 *    (`Mover.cpp:7948`); the old emulator multiplied every slot's prob by the
 *    factor instead, compounding a nerf the original never had.
 * 2. **A gate miss suppresses gold too** -- the DROPTYPE_SEED branch is inside
 *    the same `if` (`Mover.cpp:8286`).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DropService,
  dropLevelChance,
  dropLevelFactor,
  goldLevelRate,
  goldSeedId,
} from '../../src/services/drop.service';
import type { Rng } from '@flyff/combat';
import type { ResourceIndex } from '@flyff/resources';
import { CMover } from '@flyff/entities';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

/** `chance * this` is the threshold `rng.int(1e9)` is compared against. */
const PCT_UNIT = 10_000_000; // 1e9 / 100

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

/** Scripted rng: each call pulls the next `int`/`range` value from the queue. */
function scriptedRng(ints: number[], ranges: number[] = [0]): Rng {
  let ii = 0, ri = 0;
  return {
    int: () => ints[ii++ % ints.length]!,
    range: () => ranges[ri++ % ranges.length]!,
  };
}

interface Spawned {
  itemId: number;
  count: number;
  ownerId: number;
  pos: { x: number; y: number; z: number };
}

/** Recording ItemManager stub. */
function recorder(): { spawns: Spawned[]; manager: never } {
  const spawns: Spawned[] = [];
  const manager = { spawn: (i: Spawned) => { spawns.push(i); return spawns.length - 1; } };
  return { spawns, manager: manager as never };
}

/** A one-table drop index keyed by `modelIdx`. */
function dropIndex(modelIdx: number, table: Record<string, unknown>): Pick<ResourceIndex, 'drops'> {
  return {
    drops: { drops: new Map([[modelIdx, { modelIdx, ...table }]]) },
  } as unknown as Pick<ResourceIndex, 'drops'>;
}

function monster(objId: number, modelIndex: number, level = 1): CMover {
  const m = CMover.spawn(
    objId,
    { modelIndex, name: 'Aibatt', level, hp: 30, expValue: 2 },
    { x: 5, y: 0, z: 7 },
    1,
  );
  m.m_idEnemies.set(1, 30); // player 1 is first-hitter
  return m;
}

function killer(over: Partial<CharacterRow> = {}): CPlayer {
  return CPlayer.fromRow(makeRow(over), { write: () => true });
}

describe('DropService level gates', () => {
  it('dropLevelChance matches the C++ nProbability buckets', () => {
    assert.equal(dropLevelChance(1, 1), 100);  // equal level
    assert.equal(dropLevelChance(3, 1), 80);   // d=2
    assert.equal(dropLevelChance(5, 1), 60);   // d=4
    assert.equal(dropLevelChance(8, 1), 30);   // d=7
    assert.equal(dropLevelChance(20, 1), 10);  // d>7
    // The C++ does not clamp a negative diff -- an under-levelled killer sits in
    // the d<=1 bucket at 100 (Mover.cpp:7940 has no lower guard).
    assert.equal(dropLevelChance(1, 50), 100);
  });

  it('goldLevelRate matches the C++ nPenyaRate buckets (different from items)', () => {
    // Penya is nerfed on a shallower curve: 100/100/80/65/50 vs 100/80/60/30/10.
    assert.equal(goldLevelRate(1, 1), 100);
    assert.equal(goldLevelRate(3, 1), 100); // d=2 -- still full, unlike items
    assert.equal(goldLevelRate(5, 1), 80);
    assert.equal(goldLevelRate(8, 1), 65);
    assert.equal(goldLevelRate(20, 1), 50);
  });

  it('dropLevelFactor stays the 0-1 form of the same buckets', () => {
    assert.equal(dropLevelFactor(1, 1), 1.0);
    assert.equal(dropLevelFactor(20, 1), 0.1);
  });
});

describe('DropService gold seed tiers', () => {
  it('goldSeedId picks the II_GOLD_SEED tier by amount (never 0)', () => {
    // Tiers mirror propItem dwAbilityMax: 20 / 50 / 100 / 1000.
    assert.equal(goldSeedId(1), 12);    // SEED1
    assert.equal(goldSeedId(20), 12);   // SEED1 boundary
    assert.equal(goldSeedId(21), 13);   // SEED2
    assert.equal(goldSeedId(50), 13);   // SEED2 boundary
    assert.equal(goldSeedId(51), 14);   // SEED3
    assert.equal(goldSeedId(100), 14);  // SEED3 boundary
    assert.equal(goldSeedId(101), 15);  // SEED4
    assert.equal(goldSeedId(9999), 15); // SEED4
    // itemId 0 null-derefs CItemBase::SetTexture in the v19 client -- never emit it.
    assert.ok(goldSeedId(1) !== 0 && goldSeedId(9999) !== 0);
  });
});

describe('DropService.roll', () => {
  it('hits when the roll lands under chance%, owner = first-hitter', () => {
    // Equal level -> gate is 100% and consumes no rng. chance 13.9698% ->
    // threshold 139,698,000. int()=0 -> hit.
    const mover = monster(0x40000000, 20);
    const { spawns, manager } = recorder();
    const resources = dropIndex(20, {
      key: 'MI_AIBATT1', maxItem: 2,
      gold: { min: 82, max: 119 },
      items: [{ itemId: 2950, chance: 13.9698, enchant: 0, count: 1 }],
    });

    const svc = new DropService({ resources, itemManager: manager, rng: scriptedRng([0], [100]) });
    svc.roll(mover, killer());

    assert.equal(spawns.length, 2, 'item + gold');
    assert.equal(spawns[0]!.itemId, 2950);
    assert.equal(spawns[0]!.ownerId, 1, 'owner = first-hitter');
    assert.equal(spawns[1]!.itemId, 14, '100 penya -> II_GOLD_SEED3');
  });

  it('misses when the roll lands on or above chance%', () => {
    // The threshold is exclusive (`<`), so a roll exactly at it must miss --
    // that boundary is where an off-by-one silently doubles a rare drop.
    const mover = monster(0x40000001, 21);
    const { spawns, manager } = recorder();
    const resources = dropIndex(21, {
      key: 'MI_AIBATT2', maxItem: 2, gold: null,
      items: [{ itemId: 2950, chance: 10, enchant: 0, count: 1 }],
    });

    const svc = new DropService({
      resources, itemManager: manager,
      rng: scriptedRng([10 * PCT_UNIT]), // exactly 10% -> not < -> miss
    });
    svc.roll(mover, killer());
    assert.equal(spawns.length, 0);
  });

  it('rolls the level gate ONCE, not per slot', () => {
    // d=49 -> gate 10%. Two slots at 100% each. One gate roll that passes must
    // yield BOTH items: if the factor were applied per slot (the old behaviour)
    // the 100% slots would be nerfed to 10% and the scripted roll would miss.
    const mover = monster(0x40000005, 22);
    const { spawns, manager } = recorder();
    const resources = dropIndex(22, {
      key: 'MI_AIBATT3', maxItem: 0, gold: null,
      items: [
        { itemId: 2950, chance: 100, enchant: 0, count: 1 },
        { itemId: 2951, chance: 100, enchant: 0, count: 1 },
      ],
    });

    // Only the gate consumes a roll (chance-100 slots short-circuit): 0 < 10%.
    const svc = new DropService({ resources, itemManager: manager, rng: scriptedRng([0]) });
    svc.roll(mover, killer({ level: 50 }));
    assert.equal(spawns.length, 2, 'both 100% slots drop through one open gate');
  });

  it('a closed gate suppresses gold as well as items', () => {
    // C++ keeps the DROPTYPE_SEED branch inside the same `if` (Mover.cpp:8286),
    // so a gate miss is a total miss -- not "no items but still penya".
    const mover = monster(0x40000006, 23);
    const { spawns, manager } = recorder();
    const resources = dropIndex(23, {
      key: 'MI_AIBATT4', maxItem: 0,
      gold: { min: 50, max: 50 },
      items: [{ itemId: 2950, chance: 100, enchant: 0, count: 1 }],
    });

    // d=49 -> gate 10%; roll 500M >= 100M -> closed.
    const svc = new DropService({ resources, itemManager: manager, rng: scriptedRng([500_000_000], [50]) });
    svc.roll(mover, killer({ level: 50 }));
    assert.equal(spawns.length, 0);
  });

  it('needsItem opens the gate for an unsatisfied quest item', () => {
    // Same d=49 setup as the suppression test; the killer is collecting 2950, so
    // the gate is bypassed entirely rather than scaled.
    const mover = monster(0x40000003, 24);
    const resources = dropIndex(24, {
      key: 'MI_AIBATT5', maxItem: 2, gold: null,
      items: [{ itemId: 2950, chance: 100, enchant: 0, count: 1 }],
    });

    const nerfed = recorder();
    new DropService({
      resources, itemManager: nerfed.manager, rng: scriptedRng([500_000_000]),
    }).roll(mover, killer({ level: 50 }));
    assert.equal(nerfed.spawns.length, 0, 'gate still closes for a non-collector');

    const questing = recorder();
    new DropService({
      resources, itemManager: questing.manager, rng: scriptedRng([500_000_000]),
      needsItem: (_p, itemId) => itemId === 2950,
    }).roll(mover, killer({ level: 50 }));
    assert.equal(questing.spawns.length, 1, 'collector bypasses the gate');
    assert.equal(questing.spawns[0]!.itemId, 2950);
  });

  it('caps item drops at maxItem, and gold does not count toward it', () => {
    // C++ bumps the counter only in the DROPTYPE_NORMAL branch (Mover.cpp:8046),
    // so a maxItem:1 table still pays penya on top of its one item.
    const mover = monster(0x40000007, 25);
    const { spawns, manager } = recorder();
    const resources = dropIndex(25, {
      key: 'MI_AIBATT6', maxItem: 1,
      gold: { min: 10, max: 10 },
      items: [
        { itemId: 2950, chance: 100, enchant: 0, count: 1 },
        { itemId: 2951, chance: 100, enchant: 0, count: 1 },
        { itemId: 2952, chance: 100, enchant: 0, count: 1 },
      ],
    });

    const svc = new DropService({ resources, itemManager: manager, rng: scriptedRng([0], [10]) });
    svc.roll(mover, killer());

    assert.equal(spawns.length, 2, 'one item + gold');
    assert.equal(spawns[0]!.itemId, 2950);
    assert.equal(spawns[1]!.itemId, goldSeedId(10), 'penya still drops at the cap');
  });

  it('maxItem 0 means uncapped', () => {
    const mover = monster(0x40000008, 26);
    const { spawns, manager } = recorder();
    const resources = dropIndex(26, {
      key: 'MI_AIBATT7', maxItem: 0, gold: null,
      items: [
        { itemId: 2950, chance: 100, enchant: 0, count: 1 },
        { itemId: 2951, chance: 100, enchant: 0, count: 1 },
      ],
    });
    new DropService({ resources, itemManager: manager, rng: scriptedRng([0]) }).roll(mover, killer());
    assert.equal(spawns.length, 2);
  });

  it('treats count as a maximum and rolls 1..count', () => {
    // C++ `m_nItemNum = xRandom(dwNumber) + 1` (Mover.cpp:7970) -- a count:10
    // slot is a 1-10 stack, not a guaranteed 10.
    const mover = monster(0x40000009, 27);
    const { spawns, manager } = recorder();
    const resources = dropIndex(27, {
      key: 'MI_AIBATT8', maxItem: 0, gold: null,
      items: [{ itemId: 2950, chance: 100, enchant: 0, count: 10 }],
    });
    // rng.range is scripted to 4 -> a stack of 4 from a count:10 slot.
    new DropService({ resources, itemManager: manager, rng: scriptedRng([0], [4]) }).roll(mover, killer());
    assert.equal(spawns[0]!.count, 4);
  });

  it('count 1 needs no roll', () => {
    const mover = monster(0x4000000a, 28);
    const { spawns, manager } = recorder();
    const resources = dropIndex(28, {
      key: 'MI_AIBATT9', maxItem: 0, gold: null,
      items: [{ itemId: 2950, chance: 100, enchant: 0, count: 1 }],
    });
    // A range() call here would throw off every later roll, so assert the exact
    // count rather than just "in bounds".
    new DropService({ resources, itemManager: manager, rng: scriptedRng([0], [99]) }).roll(mover, killer());
    assert.equal(spawns[0]!.count, 1);
  });

  it('spawns piles at the mover XZ but the killer (ground) Y', () => {
    // Monster m_vPos.y is frozen at its spawn-point Y (no server heightmap), so
    // using it puts piles in the air and the client never ground-snaps them.
    const mover = CMover.spawn(
      0x40000004, { modelIndex: 29, name: 'Aibatt', level: 1, hp: 30, expValue: 2 },
      { x: 5, y: 300, z: 7 }, 1,
    );
    mover.m_idEnemies.set(1, 30);
    const player = killer({ y: 71.5 });
    player.m_vPos = { x: 4, y: 71.5, z: 6 };

    const { spawns, manager } = recorder();
    const resources = dropIndex(29, {
      key: 'MI_AIBATT10', maxItem: 2,
      gold: { min: 10, max: 10 },
      items: [{ itemId: 2950, chance: 100, enchant: 0, count: 1 }],
    });

    new DropService({ resources, itemManager: manager, rng: scriptedRng([0], [10]) }).roll(mover, player);

    assert.equal(spawns.length, 2);
    for (const s of spawns) {
      assert.equal(s.pos.x, 5, 'XZ stays at the corpse');
      assert.equal(s.pos.z, 7);
      assert.equal(s.pos.y, 71.5, 'Y comes from the killer (on the ground)');
    }
  });

  it('returns no spawns when the mover has no drop table', () => {
    const mover = monster(0x40000002, 999);
    const resources = { drops: { drops: new Map() } } as unknown as Pick<ResourceIndex, 'drops'>;
    const svc = new DropService({
      resources, itemManager: { spawn: () => 0 } as never, rng: scriptedRng([0]),
    });
    assert.deepEqual(svc.roll(mover, killer()), []);
  });
});

describe('DropService rate multipliers', () => {
  const resources = dropIndex(30, {
    key: 'MI_RATE', maxItem: 0, gold: null,
    items: [{ itemId: 2950, chance: 10, enchant: 0, count: 1 }],
  });

  it('dropRate scales the slot chance -- x2 turns a 10% miss into a hit', () => {
    const mover = monster(0x4000000b, 30);
    // 150M is above 10% (100M) but below 20% (200M).
    const roll = 150_000_000;

    const off = recorder();
    new DropService({
      resources, itemManager: off.manager, rng: scriptedRng([roll]),
      rates: () => ({ dropRate: 1, goldRate: 1 }),
    }).roll(mover, killer());
    assert.equal(off.spawns.length, 0, 'x1 misses');

    const doubled = recorder();
    new DropService({
      resources, itemManager: doubled.manager, rng: scriptedRng([roll]),
      rates: () => ({ dropRate: 2, goldRate: 1 }),
    }).roll(mover, killer());
    assert.equal(doubled.spawns.length, 1, 'x2 hits');
  });

  it("multiplies the server rate by the table's own dropRate", () => {
    // Mirrors prj.m_fItemDropRate * GetProp()->m_fItemDrop_Rate. x1 server on a
    // x3 boss table = x3.
    const boss = dropIndex(31, {
      key: 'MI_BOSS', maxItem: 0, gold: null, dropRate: 3,
      items: [{ itemId: 2950, chance: 10, enchant: 0, count: 1 }],
    });
    const mover = monster(0x4000000c, 31);
    const { spawns, manager } = recorder();
    new DropService({
      resources: boss, itemManager: manager,
      rng: scriptedRng([250_000_000]), // above 10%, below 30%
      rates: () => ({ dropRate: 1, goldRate: 1 }),
    }).roll(mover, killer());
    assert.equal(spawns.length, 1);
  });

  it('a rate that pushes chance past 100% clamps instead of overflowing', () => {
    const mover = monster(0x4000000d, 30);
    const { spawns, manager } = recorder();
    new DropService({
      resources, itemManager: manager,
      // Highest possible roll -- must still hit at an effective 1000%.
      rng: scriptedRng([999_999_999]),
      rates: () => ({ dropRate: 100, goldRate: 1 }),
    }).roll(mover, killer());
    assert.equal(spawns.length, 1);
  });

  it('goldRate scales the penya pile and is independent of dropRate', () => {
    const golden = dropIndex(32, {
      key: 'MI_GOLD', maxItem: 0,
      gold: { min: 100, max: 100 },
      items: [],
    });
    const mover = monster(0x4000000e, 32);

    const { spawns, manager } = recorder();
    new DropService({
      resources: golden, itemManager: manager, rng: scriptedRng([0], [100]),
      rates: () => ({ dropRate: 1, goldRate: 3 }),
    }).roll(mover, killer());
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0]!.count, 300, '100 penya x3');
    assert.equal(spawns[0]!.itemId, goldSeedId(300));
  });

  it('applies the penya level bucket to gold', () => {
    const golden = dropIndex(33, {
      key: 'MI_GOLD2', maxItem: 0,
      gold: { min: 100, max: 100 },
      items: [],
    });
    const mover = monster(0x4000000f, 33);
    const { spawns, manager } = recorder();
    // d=49 -> gold bucket 50%. Gate is also 10%, so the gate roll must pass: 0.
    new DropService({ resources: golden, itemManager: manager, rng: scriptedRng([0], [100]) })
      .roll(mover, killer({ level: 50 }));
    assert.equal(spawns[0]!.count, 50, '100 penya at the d>7 bucket');
  });

  it('defaults to x1 when no rates thunk is injected', () => {
    const mover = monster(0x40000010, 30);
    const { spawns, manager } = recorder();
    new DropService({ resources, itemManager: manager, rng: scriptedRng([150_000_000]) })
      .roll(mover, killer());
    assert.equal(spawns.length, 0, 'no rates == x1, so the 10% slot misses');
  });

  it('reads the rates thunk on every roll, so a live change takes effect', () => {
    const mover = monster(0x40000011, 30);
    const { spawns, manager } = recorder();
    let dropRate = 1;
    const svc = new DropService({
      resources, itemManager: manager,
      rng: scriptedRng([150_000_000]),
      rates: () => ({ dropRate, goldRate: 1 }),
    });

    svc.roll(mover, killer());
    assert.equal(spawns.length, 0, 'x1 misses');
    dropRate = 2;
    svc.roll(mover, killer());
    assert.equal(spawns.length, 1, 'the same service picks up the new rate');
  });
});
