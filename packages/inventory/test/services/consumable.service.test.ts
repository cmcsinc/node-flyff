/**
 * ConsumableService test -- potion/food HP/MP/FP restore + charge consume.
 *
 * Restore amounts come from the item prop (`hp_restore`/`mp_restore`/`fp_restore`);
 * each pool clamps at its max. One charge is consumed via `InventoryService.consume`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, DST } from '@flyff/entities';
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
  // Pin max via DST params (the gear/buff path) --ConsumableService clamps
  // against `getMaxHp/Mp/Fp`, NOT the cached `m_nMaxHp` field, so setting the
  // field directly would not exercise the real ceiling (see fix for the
  // stale-field cap bug where +HP_MAX gear was ignored).
  function pinMax(p: CPlayer, hp: number, mp: number, fp: number): void {
    // chg-override forces the exact max regardless of the STA/INT-derived origin
    // (`setDestParam(adj=0, chg=v)` -> `get` returns `v` outright).
    p.m_params.setDestParam(DST.HP_MAX, 0, hp);
    p.m_params.setDestParam(DST.MP_MAX, 0, mp);
    p.m_params.setDestParam(DST.FP_MAX, 0, fp);
  }

  it('restores HP/MP/FP and consumes one charge', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 50, mp: 40 }), { write: () => true });
    pinMax(player, 200, 100, 100);
    player.m_nFp = 10;
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
    pinMax(player, 200, 1000, 1000);
    const { svc } = makeSvc();
    const prop: ItemDefinition = {
      id: 1, name: 'Potion', name_id: 'ITEM_P', stack_size: 1, weight: 1,
      level_req: 1, price: 0, sell_price: 0, hp_restore: 100,
    };
    svc.apply(player, prop, 0);
    assert.equal(player.m_nHp, 200, 'clamped at max_hp');
  });

  it('clamps at the DST buffed max, not the cached field (leaf armor case)', () => {
    // Reproduces the user bug: cached field held the stale base max while gear
    // lifted the real max via DST_HP_MAX. Heal must clamp at the buffed value.
    const player = CPlayer.fromRow(makeRow({ level: 10, hp: 300 }), { write: () => true });
    player.m_nMaxHp = 333; // stale base cached on the field
    pinMax(player, 469, 1000, 1000); // +HP_MAX gear lifts the real max to 469
    const { svc } = makeSvc();
    const prop: ItemDefinition = {
      id: 1, name: 'Potion', name_id: 'ITEM_P', stack_size: 1, weight: 1,
      level_req: 1, price: 0, sell_price: 0, hp_restore: 150,
    };
    svc.apply(player, prop, 0);
    assert.equal(player.m_nHp, 450, 'heal applies up to the buffed max');
    assert.equal(player.m_nMaxHp, 469, 'field synced to buffed max');
  });

  it('skips pools with no restore value', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 10 }), { write: () => true });
    pinMax(player, 200, 1000, 1000);
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
