/**
 * EnchantService test -- PACKETTYPE_ENCHANT refine + element paths.
 *
 * Covers: refine success/fail-kept/fail-destroyed/maxed, element success +
 * mismatch, target/material validity rejects, and the non-KOR probability
 * factor. RNG is injected so the roll is deterministic per case.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import type { Rng } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/world-core';
import type { CharacterRow, InventoryRepository, Journal } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import { EnchantService } from '../../src/services/enchant.service';
import { FIRE, WATER, MAX_REFINE, refineChance, elementChance } from '../../src/upgrade/upgradeTables';

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

const SWORD: ItemDefinition = {
  id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1,
  level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_WEAPON_DIRECT',
};
const SUNSTONE: ItemDefinition = {
  id: 2035, name: 'Sunstone', name_id: 'ITEM_SU', stack_size: 99, weight: 1,
  level_req: 1, price: 0, sell_price: 0, item_kind3: 'IK3_ENCHANT',
};
const FLAME_CARD: ItemDefinition = {
  id: 3206, name: 'Flame Card', name_id: 'ITEM_FC', stack_size: 99, weight: 1,
  level_req: 1, price: 0, sell_price: 0, item_kind3: 'IK3_ELECARD',
};
const LAKE_CARD: ItemDefinition = { ...FLAME_CARD, id: 3211, name: 'Lake Card' };
const POTION: ItemDefinition = {
  id: 2000, name: 'Potion', name_id: 'ITEM_P', stack_size: 99, weight: 1,
  level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_POTION',
};

interface Harness {
  svc: EnchantService;
  consumed: number[];        // slots consumed
  journalCalls: unknown[];   // payloads appended
  setItemCalls: { slot: number; refine: number; element: number; elementLevel: number }[];
  removed: number[];         // slots removed
}

function makeHarness(rng: Rng, table: Map<number, ItemDefinition>): Harness {
  const consumed: number[] = [];
  const journalCalls: unknown[] = [];
  const setItemCalls: Harness['setItemCalls'] = [];
  const removed: number[] = [];
  const consume = (_p: unknown, slot: number, count = 1): { count: number } | null => {
    consumed.push(slot);
    const player = _p as { m_Inventory: ({ count: number } | null)[] };
    const s = player.m_Inventory[slot];
    if (!s) return null;
    const after = s.count - count;
    s.count = after;
    player.m_Inventory[slot] = after > 0 ? s : null;
    return after > 0 ? { count: after } : null;
  };
  const journal = {
    append: (e: unknown) => { journalCalls.push(e); },
  } as unknown as Journal;
  const inventoryRepo = {
    setItem: async (_cid: number, slot: number, _itemId: number, _qty: number, _flags: number, _dur: number, refine: number, _stats: unknown, element: number, elementLevel: number) =>
      { setItemCalls.push({ slot, refine, element, elementLevel }); },
    removeItem: async (_cid: number, slot: number) => { removed.push(slot); },
  } as unknown as Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  const svc = new EnchantService({ inventoryRepo, journal, getItem: (id) => table.get(id), consume, rng });
  return { svc, consumed, journalCalls, setItemCalls, removed };
}

/** Deterministic rng: always returns `roll` from `int()`. */
function rigged(roll: number): Rng {
  return { int: () => roll, range: () => roll };
}

describe('EnchantService.enchant', () => {
  it('refine success: +1 and material consumed, journal carries new refine', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5 };
    player.m_Inventory[6] = { itemId: 2035, count: 5, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[5000, SWORD], [2035, SUNSTONE]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'refine_success');
    assert.equal(player.m_Inventory[5]!.refine, 1);
    assert.equal(player.m_Inventory[6]!.count, 4);          // material -1
    assert.deepEqual(h.consumed, [6]);
    assert.equal(h.setItemCalls[0]!.refine, 1);
    assert.equal(h.setItemCalls[0]!.element, 0);
    // journal payload is absolute end-state with refine
    const jp = h.journalCalls[0] as { payload: { refine: number; itemId: number } };
    assert.equal(jp.payload.refine, 1);
    assert.equal(jp.payload.itemId, 5000);
  });

  it('refine fail below threshold: item kept, material consumed', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5, refine: 2 }; // chance 7000, below destroy threshold
    player.m_Inventory[6] = { itemId: 2035, count: 2, objid: 6 };
    const h = makeHarness(rigged(9999), new Map([[5000, SWORD], [2035, SUNSTONE]])); // roll 9999 > 7000 -> fail

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'fail_kept');
    assert.equal(player.m_Inventory[5]!.refine, 2);          // unchanged
    assert.equal(player.m_Inventory[5]!.count, 1);
    assert.equal(player.m_Inventory[6]!.count, 1);           // material still consumed
    assert.equal(h.removed.length, 0);                       // target NOT removed
  });

  it('refine fail at threshold: item destroyed (slot cleared + journal + remove)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5, refine: 3 };
    player.m_Inventory[6] = { itemId: 2035, count: 1, objid: 6 };
    const h = makeHarness(rigged(9999), new Map([[5000, SWORD], [2035, SUNSTONE]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'fail_destroyed');
    assert.equal(player.m_Inventory[5], null);               // destroyed
    assert.deepEqual(h.removed, [5]);
    const jp = h.journalCalls[0] as { payload: { itemId: number; count: number } };
    assert.equal(jp.payload.itemId, 0);                      // clear journal entry
    assert.equal(jp.payload.count, 0);
  });

  it('refine at max: rejected as maxed, material NOT consumed', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5, refine: MAX_REFINE };
    player.m_Inventory[6] = { itemId: 2035, count: 3, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[5000, SWORD], [2035, SUNSTONE]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'maxed');
    assert.equal(h.consumed.length, 0);                      // no consume
    assert.equal(player.m_Inventory[6]!.count, 3);
  });

  it('element success: sets element + bumps level', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5 };
    player.m_Inventory[6] = { itemId: 3206, count: 2, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[5000, SWORD], [3206, FLAME_CARD]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'element_success');
    if (r.kind !== 'element_success') return;
    assert.equal(r.newElement, FIRE);
    assert.equal(r.newLevel, 1);
    assert.equal(player.m_Inventory[5]!.element, FIRE);
    assert.equal(player.m_Inventory[5]!.element_level, 1);
    assert.equal(h.setItemCalls[0]!.element, FIRE);
    assert.equal(h.setItemCalls[0]!.elementLevel, 1);
  });

  it('element mismatch: 2nd element card rejected', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5, element: FIRE, element_level: 1 };
    player.m_Inventory[6] = { itemId: 3211, count: 1, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[5000, SWORD], [3211, LAKE_CARD]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'reject');
    if (r.kind !== 'reject') return;
    assert.equal(r.reason, 'element_mismatch');             // FIRE vs WATER(Lake)
    assert.equal(h.consumed.length, 0);                      // no consume on reject
    // same element card stacks onto existing -> would proceed (not mismatch)
    assert.equal(WATER, 2);
  });

  it('rejects non-refinable target (potion)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 2000, count: 1, objid: 5 };
    player.m_Inventory[6] = { itemId: 2035, count: 1, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[2000, POTION], [2035, SUNSTONE]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'reject');
    if (r.kind !== 'reject') return;
    assert.equal(r.reason, 'not_refinable');
  });

  it('rejects wrong material kind (potion as catalyst)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[5] = { itemId: 5000, count: 1, objid: 5 };
    player.m_Inventory[6] = { itemId: 2000, count: 1, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[5000, SWORD], [2000, POTION]]));

    const r = h.svc.enchant(player, 5, 6);

    assert.equal(r.kind, 'reject');
    if (r.kind !== 'reject') return;
    assert.equal(r.reason, 'wrong_material');
  });

  it('rejects equipped target (slot >= MAX_INVENTORY)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const equipSlot = MAX_INVENTORY + 9;                     // PARTS_LWEAPON
    player.m_Inventory[equipSlot] = { itemId: 5000, count: 1, objid: equipSlot };
    player.m_Inventory[6] = { itemId: 2035, count: 1, objid: 6 };
    const h = makeHarness(rigged(0), new Map([[5000, SWORD], [2035, SUNSTONE]]));

    const r = h.svc.enchant(player, equipSlot, 6);

    assert.equal(r.kind, 'reject');
    if (r.kind !== 'reject') return;
    assert.equal(r.reason, 'equipped');
  });

  it('refineChance applies the non-KOR x0.9 factor at +3+, none below', () => {
    assert.equal(refineChance(2), 7000);                     // +2->+3, no factor
    assert.equal(refineChance(3), Math.round(6000 * 0.9));   // +3->+4, x0.9
    assert.equal(refineChance(9), Math.round(500 * 0.9));    // +9->+10, x0.9
    assert.equal(elementChance(0), 10000);                   // element table has no factor
  });
});
