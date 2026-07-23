/**
 * UseItemService test -- DOUSEITEM router.
 *
 * Takes the resolved bag `slot` (handler resolves the wire objid -> slot via
 * `CPlayer.findSlotByObjId`, since the client addresses items by stable m_dwObjId
 * which drifts from the slot after a move). Routes by prop fields:
 *   equip_slot set -> EquipService.equip
 *   item_kind2 IK2_POTION/FOOD -> ConsumableService.apply
 *   item_kind2 IK2_BUFF/BUF2/SKILL/TEXT/WARP -> consume charge (effect ponytail)
 *   else reject
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { UseItemService } from '../../src/services/useItem.service';
import { MAX_INVENTORY } from '@flyff/world-core';
import type { CharacterRow } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import type { EquipService, EquipResult } from '../../src/services/equip.service';
import type { ConsumableService, ConsumableResult } from '../../src/services/consumable.service';
import type { InventoryService } from '../../src/services/inventory.service';

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

function makeSvc(opts: {
  getItem: (id: number) => ItemDefinition | undefined;
  equipResult?: EquipResult;
  consumableResult?: ConsumableResult;
  potionCooldownMs?: number;
}) {
  let equipCalled = false;
  let consumeCalled = false;
  let applyCalled = false;
  const equipService = {
    equip: () => { equipCalled = true; return opts.equipResult ?? { ok: true, parts: 9, itemId: 5000, invSlot: 4 }; },
  } as unknown as EquipService;
  const consumableService = {
    apply: () => { applyCalled = true; return opts.consumableResult ?? { hp: 150, consumed: null }; },
  } as unknown as ConsumableService;
  const inventoryService = {
    consume: () => { consumeCalled = true; return null; },
  } as unknown as InventoryService;
  const svc = new UseItemService({
    equipService, consumableService, inventoryService,
    getItem: opts.getItem,
    potionCooldownMs: opts.potionCooldownMs ?? 1000,
  });
  return { svc, equipCalled: () => equipCalled, applyCalled: () => applyCalled, consumeCalled: () => consumeCalled };
}

describe('UseItemService.use', () => {
  it('routes an equip_slot item to EquipService (slot = HIWORD(dwData))', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[4] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc, equipCalled } = makeSvc({ getItem: (id) => table.get(id) });

    const r = svc.use(player, 4, 9);

    assert.equal(r.kind, 'equip');
    assert.equal(equipCalled(), true);
  });

  it('routes an IK2_POTION to ConsumableService', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[2] = { itemId: 7000, count: 5 };
    const table = new Map<number, ItemDefinition>([
      [7000, { id: 7000, name: 'Potion', name_id: 'ITEM_P', stack_size: 99, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_POTION' }],
    ]);
    const { svc, applyCalled } = makeSvc({
      getItem: (id) => table.get(id),
      consumableResult: { hp: 180, mp: 90, consumed: null },
    });

    const r = svc.use(player, 2, 0);

    assert.equal(r.kind, 'consumable');
    if (r.kind === 'consumable') {
      assert.equal(r.nId, 2);
      assert.equal(r.hp, 180);
      assert.equal(r.mp, 90);
    }
    assert.equal(applyCalled(), true);
  });

  it('routes IK2_BUFF to consume-only (effect ponytail)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 7100, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [7100, { id: 7100, name: 'Buff', name_id: 'ITEM_B', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_BUFF' }],
    ]);
    const { svc, consumeCalled } = makeSvc({ getItem: (id) => table.get(id) });

    const r = svc.use(player, 1, 0);

    assert.equal(r.kind, 'consumed');
    assert.equal(consumeCalled(), true, 'charge consumed');
  });

  it('rejects when the slot is empty', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc({ getItem: () => undefined });
    const r = svc.use(player, 0, 0);
    assert.equal(r.kind, 'reject');
  });

  it('rejects when nId (HIWORD) is outside the main bag', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc({ getItem: () => undefined });
    const r = svc.use(player, MAX_INVENTORY, 0);
    assert.equal(r.kind, 'reject');
  });

  it('rejects a potion on cooldown WITHOUT spending the charge', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[2] = { itemId: 7000, count: 5 };
    const table = new Map<number, ItemDefinition>([
      [7000, { id: 7000, name: 'Potion', name_id: 'ITEM_P', stack_size: 99, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_POTION' }],
    ]);
    const { svc, applyCalled } = makeSvc({ getItem: (id) => table.get(id), potionCooldownMs: 5000 });
    player.m_cooltime[3] = Date.now() + 4000; // potion group locked

    const r = svc.use(player, 2, 0);

    assert.equal(r.kind, 'reject');
    assert.equal(applyCalled(), false, 'charge not spent on cooldown');
  });

  it('sets the potion cooldown group + flags cooltime on a successful use', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[2] = { itemId: 7000, count: 5 };
    const table = new Map<number, ItemDefinition>([
      [7000, { id: 7000, name: 'Potion', name_id: 'ITEM_P', stack_size: 99, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_POTION' }],
    ]);
    const { svc } = makeSvc({ getItem: (id) => table.get(id), potionCooldownMs: 1000 });

    const r = svc.use(player, 2, 0);

    assert.equal(r.kind, 'consumable');
    if (r.kind === 'consumable') assert.equal(r.cooltime, true);
    assert.ok(player.m_cooltime[3] > Date.now(), 'potion group locked after use');
  });

  it('gates food (group 1) by cooldown_ms from the data', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 8000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [8000, { id: 8000, name: 'Lollipop', name_id: 'ITEM_L', stack_size: 99, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_FOOD', item_kind3: 'IK3_INSTANT', cooldown_ms: 2500 }],
    ]);
    const { svc } = makeSvc({ getItem: (id) => table.get(id) });

    const first = svc.use(player, 1, 0);
    assert.equal(first.kind, 'consumable');
    assert.ok(player.m_cooltime[0] > Date.now(), 'food group locked');

    const second = svc.use(player, 1, 0);
    assert.equal(second.kind, 'reject', 'still on cooldown');
  });
});
