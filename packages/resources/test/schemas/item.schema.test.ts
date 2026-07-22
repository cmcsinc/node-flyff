/**
 * ItemDefinitionSchema test -- parses the new Phase 0A fields.
 *
 * `stack_size` defaults to 1 (non-stacking); `equip_slot`/`weapon_type`/
 * `item_kind2`/`item_kind3` are optional routing keys; `attack_min`/`attack_max`
 * split the raw ability range; `attack_speed` is the raw dwAttackSpeed.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ItemDefinitionSchema } from '../../src/schemas/item.schema.js';

const BASE = {
  id: 2950,
  name: 'Vagrant Sword',
  name_id: 'IDS_PROPITEM_SWORD',
} as const;

describe('ItemDefinitionSchema -- Phase 0A fields', () => {
  it('fills stack_size=1 when omitted', () => {
    const item = ItemDefinitionSchema.parse(BASE);
    assert.equal(item.stack_size, 1);
    assert.equal(item.level_req, 1, 'level_req default');
    assert.equal(item.weight, 1, 'weight default');
  });

  it('parses stack_size from dwPackMax', () => {
    const item = ItemDefinitionSchema.parse({ ...BASE, stack_size: 99 });
    assert.equal(item.stack_size, 99);
  });

  it('parses equip routing fields (equip_slot / weapon_type / item_kind2)', () => {
    const item = ItemDefinitionSchema.parse({
      ...BASE,
      equip_slot: 9,
      weapon_type: 1,
      item_kind2: 'IK2_POTION',
      item_kind3: 'IK3_HEAL',
    });
    assert.equal(item.equip_slot, 9);
    assert.equal(item.weapon_type, 1);
    assert.equal(item.item_kind2, 'IK2_POTION');
    assert.equal(item.item_kind3, 'IK3_HEAL');
  });

  it('parses split attack_min/attack_max + raw attack_speed', () => {
    const item = ItemDefinitionSchema.parse({
      ...BASE, attack_min: 20, attack_max: 30, attack_speed: 40,
    });
    assert.equal(item.attack_min, 20);
    assert.equal(item.attack_max, 30);
    assert.equal(item.attack_speed, 40);
  });

  it('parses consumable restore fields', () => {
    const item = ItemDefinitionSchema.parse({
      ...BASE, hp_restore: 150, mp_restore: 60, fp_restore: 30,
    });
    assert.equal(item.hp_restore, 150);
    assert.equal(item.mp_restore, 60);
    assert.equal(item.fp_restore, 30);
  });

  it('parses jewelry HR/ER fields (nAdjHitRate / dwParry)', () => {
    const item = ItemDefinitionSchema.parse({
      ...BASE, hit_rate: 12, parry: 8,
    });
    assert.equal(item.hit_rate, 12);
    assert.equal(item.parry, 8);
  });

  it('rejects a non-positive id', () => {
    assert.throws(() => ItemDefinitionSchema.parse({ ...BASE, id: -1 }));
  });
});
