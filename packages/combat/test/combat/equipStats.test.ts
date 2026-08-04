/**
 * sumEquipStats test -- weapon + armor fold from equipped slots.
 *
 * Equipped items live at `m_Inventory[MAX_INVENTORY + part]`. RWEAPON=10 is the
 * weapon slot every propItem weapon row uses (LWEAPON=9 only holds a Blade
 * off-hand / yoyo); armor parts {2,3,4,5,6,11} sum into DEF. Bare-hands +
 * 0 DEF fallback when nothing is equipped (matches CPlayer defaults).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { sumEquipStats } from '../../src/combat/equipStats';
import { MAX_INVENTORY } from '@flyff/world-core';
import { NO_PROP, WT_MELEE_SWD, WT_RANGE_BOW } from '../../src/combat/tables';
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

  it('reads weapon min/max/type/speed from RWEAPON slot (part 10)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 10] = { itemId: 5000, count: 1, refine: 3 };
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
    assert.equal(r.weapon.option, 3, 'refine feeds option as raw level (formula applies pow(option,1.5))');
  });

  // Regression: every propItem weapon row carries dwParts=PARTS_RWEAPON(10), so
  // reading LWEAPON(9) as THE weapon slot yielded bare hands for every player --
  // zeroing weapon ATK and false-rejecting the bow gate in DoAttackRange.
  it('reports a bow equipped in RWEAPON as a ranged weapon type', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 10] = { itemId: 431, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [431, {
        id: 431, name: 'Woodness Bow', name_id: 'ITEM_B', stack_size: 1, weight: 1,
        level_req: 1, price: 0, sell_price: 0,
        attack_min: 36, attack_max: 37, weapon_type: WT_RANGE_BOW, attack_speed: 7,
      }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.weapon.type, WT_RANGE_BOW, 'bow in slot 10 must read as WT_RANGE_BOW');
    assert.equal(r.weapon.min, 36);
  });

  // Blade dual-wield / yoyo: DoEquip parks the off-hand in LWEAPON
  // (MoverEquip.cpp:515), so it stays a valid fallback when RWEAPON is empty.
  it('falls back to the LWEAPON slot (part 9) when RWEAPON is empty', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 9] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, {
        id: 5000, name: 'Offhand', name_id: 'ITEM_O', stack_size: 1, weight: 1,
        level_req: 1, price: 0, sell_price: 0,
        attack_min: 20, attack_max: 30, weapon_type: WT_MELEE_SWD, attack_speed: 40,
      }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.weapon.min, 20, 'off-hand still feeds the weapon curve');
  });

  it('reads weapon element from the slot instance field', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 10] = { itemId: 5000, count: 1, element: 1 /* FIRE */ };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, attack_min: 1, attack_max: 3, weapon_type: WT_MELEE_SWD, attack_speed: 40 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.weapon.element, 1, 'weapon element from slot.element');
  });

  it('falls back to the weapon propItem element name when no instance element', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 10] = { itemId: 5000, count: 1 }; // no slot.element
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, attack_min: 1, attack_max: 3, weapon_type: WT_MELEE_SWD, attack_speed: 40, element: 'electric' }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.weapon.element, 3, 'electric name -> ELECTRICITY(3)');
  });

  it('instance element overrides the propItem element name', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 10] = { itemId: 5000, count: 1, element: 1 /* FIRE */ };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, attack_min: 1, attack_max: 3, weapon_type: WT_MELEE_SWD, attack_speed: 40, element: 'water' }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.weapon.element, 1, 'slot instance FIRE wins over propItem water');
  });

  it('falls back to the suit propItem element name for defender element', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1 }; // no slot.element
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18, element: 'earth' }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.element, 5, 'earth name -> EARTH(5)');
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

  it('adds floor(pow(refine,1.5)) per armor piece to DEF (SumEquipDefenseAbility)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1, refine: 4 }; // +floor(4^1.5)=+8
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.armorDef, 26, '18 + floor(pow(4,1.5))=8');
  });

  it('computes armorDefMax from defense_max (C++ SumEquipDefenseAbility dwAbilityMax)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1 }; // UPPER_BODY
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18, defense_max: 22 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.armorDef, 18, 'min uses defense (dwAbilityMin)');
    assert.equal(r.armorDefMax, 22, 'max uses defense_max (dwAbilityMax)');
  });

  it('armorDefMax falls back to defense when defense_max is undefined', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.armorDef, 18);
    assert.equal(r.armorDefMax, 18, 'no defense_max -> uses defense for both');
  });

  it('armorDefMax includes refine bonus (matches C++ nOptionVal added to both min and max)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1, refine: 4 }; // +floor(4^1.5)=+8
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18, defense_max: 22 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.armorDef, 26, '18 + 8 refine');
    assert.equal(r.armorDefMax, 30, '22 + 8 refine');
  });

  it('folds jewelry hit_rate + parry from equipped parts (DST_ADJ_HITRATE / DST_PARRY)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    // RING1=20, EARRING1=22 -- jewelry slots
    p.m_Inventory[MAX_INVENTORY + 20] = { itemId: 7000, count: 1 };
    p.m_Inventory[MAX_INVENTORY + 22] = { itemId: 7001, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [7000, { id: 7000, name: 'Ring', name_id: 'ITEM_R', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, hit_rate: 10 }],
      [7001, { id: 7001, name: 'Earring', name_id: 'ITEM_E', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, parry: 5 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.adjHitRate, 10, 'ring nAdjHitRate');
    assert.equal(r.parry, 5, 'earring dwParry');
  });

  it('defender suit element comes from UPPER_BODY (part 2)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 6100, count: 1, element: 2 /* WATER */ };
    const table = new Map<number, ItemDefinition>([
      [6100, { id: 6100, name: 'Suit', name_id: 'ITEM_A', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, defense: 18 }],
    ]);
    const r = sumEquipStats(p, (id) => table.get(id));
    assert.equal(r.element, 2, 'suit element from UPPER_BODY');
  });

  it('skips armor whose item definition is missing', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_Inventory[MAX_INVENTORY + 2] = { itemId: 9999, count: 1 };
    const r = sumEquipStats(p, () => undefined);
    assert.equal(r.armorDef, 0, 'unknown item contributes no DEF');
  });
});
