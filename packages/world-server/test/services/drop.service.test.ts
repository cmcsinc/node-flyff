/**
 * DropService test -- deterministic rng asserts per-slot hit/miss, level-diff
 * gating, gold pile, and looter = first-hitter.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DropService, dropLevelFactor, goldSeedId } from '../../src/services/drop.service';
import type { Rng } from '../../src/combat/formulas';
import type { ResourceIndex } from '@flyff/resources';
import { CMover } from '../../src/entities/mover';
import { CPlayer } from '../../src/entities/player';
import type { CharacterRow } from '@flyff/database';

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
function scriptedRng(ints: number[], ranges: number[]): Rng {
  let ii = 0, ri = 0;
  return {
    int: () => ints[ii++ % ints.length]!,
    range: () => ranges[ri++ % ranges.length]!,
  };
}

describe('DropService', () => {
  it('dropLevelFactor matches the C++ level-diff buckets', () => {
    assert.equal(dropLevelFactor(1, 1), 1.0);   // equal level
    assert.equal(dropLevelFactor(3, 1), 0.8);   // d=2
    assert.equal(dropLevelFactor(5, 1), 0.6);   // d=4
    assert.equal(dropLevelFactor(8, 1), 0.3);   // d=7
    assert.equal(dropLevelFactor(20, 1), 0.1);  // d>7
  });

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
    // itemId 0 null-derefs CItemBase::SetTexture in the v15 client -- never emit it.
    assert.ok(goldSeedId(1) !== 0 && goldSeedId(9999) !== 0);
  });

  it('rolls a hit when rng < prob, spawns the item with first-hitter as owner', () => {
    // prob 300M / scale 3B = 10%. int(3e9)=0 -> 0 < 300M*1.0 -> hit.
    const mover = CMover.spawn(0x40000000, { modelIndex: 20, name: 'Aibatt', level: 1, hp: 30, expValue: 2 }, { x: 5, y: 0, z: 5 }, 1);
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    // First-hitter is player (id 1) -- record 30 damage.
    mover.m_idEnemies.set(1, 30);

    const spawns: Array<{ itemId: number; count: number; ownerId: number }> = [];
    const itemManager = { spawn: (_i: { itemId: number; count: number; ownerId: number }) => { spawns.push(_i); return 0; } };
    const resources = {
      drops: {
        drops: new Map([[20, {
          key: 'MI_AIBATT1', modelIdx: 20, maxItem: 2,
          gold: { min: 82, max: 119 },
          items: [{ itemId: 2950, prob: 300_000_000, level: 0, count: 1 }],
        }]]),
        probScale: 3_000_000_000,
      },
    } as unknown as Pick<ResourceIndex, 'drops'>;

    const svc = new DropService({ resources, itemManager: itemManager as never, rng: scriptedRng([0], [100]) });
    svc.roll(mover, player);

    assert.equal(spawns.length, 2); // twinklestone + gold
    assert.equal(spawns[0]!.itemId, 2950);
    assert.equal(spawns[0]!.ownerId, 1, 'owner = first-hitter');
    // scripted rng.range returns 100 -> 100 penya lands in the SEED3 tier (<=100).
    assert.equal(spawns[1]!.itemId, goldSeedId(100));
    assert.equal(spawns[1]!.itemId, 14, '100 penya -> II_GOLD_SEED3');
    assert.ok(spawns[1]!.count >= 82 && spawns[1]!.count <= 119, 'gold within range');
  });

  it('misses when rng >= prob*factor; high level diff suppresses the drop', () => {
    const mover = CMover.spawn(0x40000001, { modelIndex: 21, name: 'Aibatt', level: 1, hp: 10, expValue: 1 }, { x: 0, y: 0, z: 0 }, 1);
    const player = CPlayer.fromRow(makeRow({ level: 50 }), { write: () => true }); // d=49 -> factor 0.1
    mover.m_idEnemies.set(1, 10);

    const spawns: Array<{ itemId: number; count: number; ownerId: number }> = [];
    const itemManager = { spawn: (_i: { itemId: number; count: number; ownerId: number }) => { spawns.push(_i); return 0; } };
    const resources = {
      drops: {
        drops: new Map([[21, {
          key: 'MI_AIBATT2', modelIdx: 21, maxItem: 2, gold: null,
          items: [{ itemId: 2950, prob: 300_000_000, level: 0, count: 1 }],
        }]]),
        probScale: 3_000_000_000,
      },
    } as unknown as Pick<ResourceIndex, 'drops'>;

    // int(3e9)=2.9e9; prob*factor = 300M*0.1 = 30M -> 2.9e9 >= 30M -> miss.
    const svc = new DropService({ resources, itemManager: itemManager as never, rng: scriptedRng([2_900_000_000], [0]) });
    svc.roll(mover, player);
    assert.equal(spawns.length, 0);
  });

  it('returns no spawns when the mover has no drop table', () => {
    const mover = CMover.spawn(0x40000002, { modelIndex: 999, name: 'X', level: 1, hp: 1, expValue: 0 }, { x: 0, y: 0, z: 0 }, 1);
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const itemManager = { spawn: () => 0 };
    const resources = { drops: { drops: new Map(), probScale: 3_000_000_000 } } as unknown as Pick<ResourceIndex, 'drops'>;
    const svc = new DropService({ resources, itemManager: itemManager as never, rng: scriptedRng([0], [0]) });
    assert.deepEqual(svc.roll(mover, player), []);
  });
});
