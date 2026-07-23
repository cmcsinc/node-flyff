/**
 * ConsumableService test -- potion/food HP/MP/FP restore + charge consume.
 *
 * Restore amounts come from the item prop (`hp_restore`/`mp_restore`/`fp_restore`);
 * each pool clamps at its max. One charge is consumed via `InventoryService.consume`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player';
import { ConsumableService } from '../../src/services/consumable.service';
import type { CharacterRow } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';

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

function makeSvc() {
  let consumed: { slot: number; count: number } | null = null;
  const inventory = {
    consume: (_p: unknown, slot: number, count: number) => { consumed = { slot, count }; return null; },
  } as never;
  const svc = new ConsumableService(inventory);
  return { svc, getConsumed: () => consumed };
}

describe('ConsumableService.apply', () => {
  it('restores HP/MP/FP and consumes one charge', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 50, mp: 40 }), { write: () => true });
    // Max HP/MP are formula-derived in fromRow; pin to the test's ceiling.
    player.m_nMaxHp = 200;
    player.m_nMaxMp = 100;
    player.m_nFp = 10;
    player.m_nMaxFp = 100;
    const { svc, getConsumed } = makeSvc();
    const prop: ItemDefinition = {
      id: 1, name: 'Potion', name_id: 'ITEM_P', stack_size: 1, weight: 1,
      level_req: 1, price: 0, sell_price: 0, hp_restore: 100, mp_restore: 60, fp_restore: 30,
    };

    const r = svc.apply(player, prop, 3);

    assert.equal(player.m_nHp, 150, 'HP += restore');
    assert.equal(player.m_nMp, 100, 'MP clamped at max');
    assert.equal(player.m_nFp, 40, 'FP += restore');
    assert.equal(r.hp, 150);
    assert.equal(r.mp, 100);
    assert.equal(r.fp, 40);
    assert.ok(player._dirty.has('m_nHp'));
    assert.ok(player._dirty.has('m_nMp'));
    assert.ok(player._dirty.has('m_nFp'));
    assert.deepEqual(getConsumed(), { slot: 3, count: 1 }, 'consume(slot,1) called');
  });

  it('clamps HP at max_hp (no overheal)', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 180, max_hp: 200 }), { write: () => true });
    player.m_nMaxHp = 200;
    const { svc } = makeSvc();
    const prop: ItemDefinition = {
      id: 1, name: 'Potion', name_id: 'ITEM_P', stack_size: 1, weight: 1,
      level_req: 1, price: 0, sell_price: 0, hp_restore: 100,
    };
    svc.apply(player, prop, 0);
    assert.equal(player.m_nHp, 200, 'clamped at max_hp');
  });

  it('skips pools with no restore value', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 10 }), { write: () => true });
    const { svc } = makeSvc();
    const prop: ItemDefinition = {
      id: 1, name: 'Food', name_id: 'ITEM_F', stack_size: 1, weight: 1,
      level_req: 1, price: 0, sell_price: 0, hp_restore: 50,
    };
    const r = svc.apply(player, prop, 0);
    assert.equal(r.hp, 60);
    assert.equal(r.mp, undefined, 'no MP restore field -> omitted');
    assert.equal(r.fp, undefined);
  });
});
