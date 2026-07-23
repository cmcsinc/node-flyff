/**
 * EquipService test -- equip/unequip slot moves + validation branches.
 *
 * Equip moves an item from main-bag `invSlot` to `m_Inventory[MAX_INVENTORY+parts]`,
 * swapping any previously-equipped item back into `invSlot`. `parts` must match
 * the item's own `equip_slot` (anti-cheat); RIDE(13) is rejected.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { EquipService } from '../../src/services/equip.service';
import { MAX_INVENTORY } from '@flyff/world-core';
import type { CharacterRow } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 20, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSvc(getItem: (id: number) => ItemDefinition | undefined) {
  const setItemCalls: Array<{ slot: number; itemId: number }> = [];
  const removedSlots: number[] = [];
  const journalCalls: Array<{ type: string }> = [];
  const svc = new EquipService({
    inventoryRepo: {
      setItem: async (_c: number, slot: number, itemId: number) => { setItemCalls.push({ slot, itemId }); },
      removeItem: async (_c: number, slot: number) => { removedSlots.push(slot); },
    },
    getItem,
    journal: { append: (e: { type: string }) => { journalCalls.push(e); } } as never,
  });
  return { svc, setItemCalls, removedSlots, journalCalls };
}

describe('EquipService.equip', () => {
  it('resolves the equip slot from the item prop when nPart=-1 (client double-click default)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));

    // Client sends nPart = -1 (SendDoEquip default arg) for double-click / drag-drop.
    const r = svc.equip(player, 0, -1);

    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.parts, 9, 'parts resolved from prop.equip_slot');
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5000, 'weapon equipped via auto-resolved slot');
  });

  it('moves the item into the LWEAPON equip slot + journals before persist', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc, journalCalls } = makeSvc((id) => table.get(id));

    const r = svc.equip(player, 0, 9);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.parts, 9);
      assert.equal(r.itemId, 5000);
    }
    assert.deepEqual(player.m_Inventory[0], null, 'main-bag slot cleared');
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5000, 'weapon in LWEAPON slot');
    assert.ok(player._dirty.has('m_Inventory'));
    assert.deepEqual(
      journalCalls.map((j) => j.type),
      ['INVENTORY_SLOT', 'INVENTORY_SLOT'],
      'canonical INVENTORY_SLOT journaled for both touched slots',
    );
  });

  it('swaps a previously-equipped item back into the inv slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5001, count: 1 }; // new weapon in bag
    player.m_Inventory[MAX_INVENTORY + 9] = { itemId: 5000, count: 1 }; // equipped old weapon
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Old', name_id: 'ITEM_O', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
      [5001, { id: 5001, name: 'New', name_id: 'ITEM_N', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));

    const r = svc.equip(player, 0, 9);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5001, 'new weapon equipped');
    assert.equal(player.m_Inventory[0]!.itemId, 5000, 'old weapon swapped back to bag');
  });

  it('rejects RIDE(13) parts as restricted', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 9000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [9000, { id: 9000, name: 'Board', name_id: 'ITEM_B', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 13 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));
    const r = svc.equip(player, 0, 13);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'restricted');
  });

  it('equips at the prop equip_slot regardless of client nPart (server-authoritative)', () => {
    // Client nPart is advisory -- the server always uses the item's own slot, so
    // a lagging claim (e.g. fashion dwParts remap PARTS_CAP->PARTS_HAT) can't
    // misroute or reject the equip. Client claims UPPER_BODY(2); item is LWEAPON.
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));
    const r = svc.equip(player, 0, 2);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.parts, 9, 'equipped at the real slot, not the client claim');
      assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5000);
    }
  });

  it('rejects out-of-range invSlot and parts', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc(() => undefined);
    assert.equal(svc.equip(player, MAX_INVENTORY, 9).ok, false, 'invSlot in equip range');
    assert.equal(svc.equip(player, 0, 0).ok, false, 'parts=0');
    assert.equal(svc.equip(player, 0, 31).ok, false, 'parts>=MAX_HUMAN_PARTS');
  });

  it('rejects when player level below level_req', () => {
    const player = CPlayer.fromRow(makeRow({ level: 5 }), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 10, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));
    const r = svc.equip(player, 0, 9);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'restricted');
  });
});

describe('EquipService.unequip', () => {
  it('moves the equipped item into the first empty main-bag slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[MAX_INVENTORY + 9] = { itemId: 5000, count: 1 };
    const { svc, removedSlots } = makeSvc(() => undefined);

    const r = svc.unequip(player, 9);

    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.invSlot, 0, 'first empty main-bag slot');
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9], null, 'equip slot cleared');
    assert.equal(player.m_Inventory[0]!.itemId, 5000, 'item now in bag slot 0');
    assert.ok(removedSlots.includes(MAX_INVENTORY + 9), 'equip slot removed from DB');
  });

  it('rejects unequip of an empty slot with not_equipped', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc(() => undefined);
    const r = svc.unequip(player, 9);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'not_equipped');
  });
});
