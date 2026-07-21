/**
 * sumEquipStats test — weapon + armor fold from equipped slots.
 *
 * Equipped items live at `m_Inventory[MAX_INVENTORY + part]`. LWEAPON=9 feeds
 * the weapon stats; armor parts {2,3,4,5,6,11} sum into DEF. Bare-hands +
 * 0 DEF fallback when nothing is equipped (matches CPlayer defaults).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player.js';
import { sumEquipStats } from '../../src/combat/equipStats.js';
import { MAX_INVENTORY } from '../../src/net/snapshot/constants.js';
import { NO_PROP, WT_MELEE_SWD } from '../../src/combat/tables.js';
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

describe('sumEquipStats', () => {
  it('falls back to bare hands + 0 DEF with nothing equipped', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    const r = sumEquipStats(p, () => undefined);
    assert.equal(r.armorDef, 0);
    assert.equal(r.weapon.min, 1);
    assert.equal(r.weapon.max, 3);
    assert.equal(r.weapon.type, WT_MELEE_SWD);
    assert.equal(r.weapon.element, NO_PROP);
  });

  it('reads weapon min/max/type/speed from LWEAPON slot (part 9)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 9] = { itemId: 5000, count: 1, refine: 3 };
    const table = new Map<number, ItemDefinition>([
      [5000, {
        id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1,
        level_req: 1, price: 0, sell_price: 0,
        attack_min: 20, attack_max: 30, weapon_type: WT_MELEE_SWD, attack_speed: 40,
      }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.weapon.min, 20);
    assert.equal(r.weapon.max, 30);
    assert.equal(r.weapon.type, WT_MELEE_SWD);
    assert.equal(r.weapon.atkSpeed, 0.4, 'raw dwAttackSpeed / 100');
    assert.equal(r.weapon.option, 3 << 4, 'refine encoded high nibble');
  });

  it('sums defense across all six armor parts', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    // UPPER_BODY=2, LOWER_BODY=3, HAND=4, FOOT=5, CAP=6, SHIELD=11
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1 };
    p.m_Inventory[MAX_INVENTORY + 6] = { itemId: 6101, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18 }],
      [6101, { id: 6101, name: 'Helm', name_id: 'ITEM_H', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 7 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.armorDef, 25, '18 + 7');
  });

  it('skips armor whose item definition is missing', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 9999, count: 1 };
    const r = sumEquipStats(p, () => undefined);
    assert.equal(r.armorDef, 0, 'unknown item contributes no DEF');
  });
});
