/**
 * cooltimeGroup test -- consumable cooldown classification.
 *
 * Mirrors C++ `CCooltimeMgr::GetGroup` (`CooltimeMgr.cpp:19-43`): food/pill/
 * skill grouped + a 4th potion group (our addition). Group 0 when duration <= 0.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { cooltimeGroup } from '../../src/services/cooltime';
import type { ItemDefinition } from '@flyff/resources';

function item(over: Partial<ItemDefinition>): ItemDefinition {
  return {
    id: 1, name: 'x', name_id: 'ITEM_X', stack_size: 1, weight: 1,
    level_req: 1, price: 0, sell_price: 0, ...over,
  };
}

describe('cooltimeGroup', () => {
  it('food -> group 1, duration from cooldown_ms', () => {
    const r = cooltimeGroup(item({ item_kind2: 'IK2_FOOD', item_kind3: 'IK3_INSTANT', cooldown_ms: 2500 }), 1000);
    assert.deepEqual(r, { group: 1, ms: 2500 });
  });

  it('food + IK3_PILL -> group 2', () => {
    const r = cooltimeGroup(item({ item_kind2: 'IK2_FOOD', item_kind3: 'IK3_PILL', cooldown_ms: 2500 }), 1000);
    assert.deepEqual(r, { group: 2, ms: 2500 });
  });

  it('skill -> group 3', () => {
    const r = cooltimeGroup(item({ item_kind2: 'IK2_SKILL', cooldown_ms: 2500 }), 1000);
    assert.deepEqual(r, { group: 3, ms: 2500 });
  });

  it('potion -> group 4, falls back to config default when cooldown_ms unset', () => {
    const r = cooltimeGroup(item({ item_kind2: 'IK2_POTION' }), 1000);
    assert.deepEqual(r, { group: 4, ms: 1000 });
  });

  it('potion with explicit cooldown_ms uses it over the default', () => {
    const r = cooltimeGroup(item({ item_kind2: 'IK2_POTION', cooldown_ms: 500 }), 1000);
    assert.deepEqual(r, { group: 4, ms: 500 });
  });

  it('returns group 0 when duration <= 0 (matches C++ dwSkillReady<=0)', () => {
    assert.deepEqual(cooltimeGroup(item({ item_kind2: 'IK2_FOOD', cooldown_ms: 0 }), 0), { group: 0, ms: 0 });
    assert.deepEqual(cooltimeGroup(item({ item_kind2: 'IK2_POTION' }), 0), { group: 0, ms: 0 });
  });

  it('returns group 0 for non-consumable kinds', () => {
    assert.deepEqual(cooltimeGroup(item({ item_kind2: 'IK2_BUFF', cooldown_ms: 2500 }), 1000), { group: 0, ms: 0 });
  });
});
