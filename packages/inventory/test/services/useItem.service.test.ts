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
import { MAX_INVENTORY, INVENTORY_SLOTS } from '@flyff/world-core';
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
  togglePet?: (player: CPlayer, itemObjid: number, linkKind: number) => boolean;
}) {
  let equipCalled = false;
  let unequipCalled: number | false = false;
  let consumeCalled = false;
  let applyCalled = false;
  const equipService = {
    equip: () => { equipCalled = true; return opts.equipResult ?? { ok: true, parts: 9, itemId: 5000, invSlot: 4 }; },
    unequip: (_p: unknown, parts: number) => { unequipCalled = parts; return { ok: true, parts, itemId: 5000, invSlot: 0, objid: 0 }; },
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
    playerManager: { sendTo: () => {} } as never,
    zoneManager: { broadcastAround: () => 0 } as never,
    ...(opts.togglePet ? { togglePet: opts.togglePet } : {}),
  });
  return { svc, equipCalled: () => equipCalled, unequipCalled: () => unequipCalled, applyCalled: () => applyCalled, consumeCalled: () => consumeCalled };
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
      [7100, { id: 7100, name: 'Buff', name_id: 'ITEM_B', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_BUFF', effects: [] }],
    ]);
    const { svc, consumeCalled } = makeSvc({ getItem: (id) => table.get(id) });

    const r = svc.use(player, 1, 0);

    assert.equal(r.kind, 'consumed');
    assert.equal(consumeCalled(), true, 'charge consumed');
  });

  it('applies a DST buff from an IK2_BUFF item with effects + duration', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 7200, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [7200, {
        id: 7200, name: 'Fire Pill', name_id: 'ITEM_FP', stack_size: 1, weight: 1,
        level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_BUFF',
        duration: 300, // 5 minutes in seconds (schema: seconds→ms in impl)
        effects: [{ dst: 1, adj: 20 }], // +20 STR
      }],
    ]);
    const { svc, consumeCalled } = makeSvc({ getItem: (id) => table.get(id) });

    const r = svc.use(player, 1, 0);

    assert.equal(r.kind, 'consumed');
    assert.equal(consumeCalled(), true, 'charge consumed');
    // Buff applied to the player buff container + ParamModel DST pool
    assert.equal(player.m_buffs.has(7200), true);
    assert.equal(player.m_params.get(1 /* DST_STR */, 0), 20);
  });

  it('rejects when the slot is empty', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc({ getItem: () => undefined });
    const r = svc.use(player, 0, 0);
    assert.equal(r.kind, 'reject');
  });

  it('rejects when the slot index is out of range', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc({ getItem: () => undefined });
    const r = svc.use(player, INVENTORY_SLOTS, 0);
    assert.equal(r.kind, 'reject');
  });

  it('routes an item sitting in an equip slot to unequip (DoUseEquipmentItem bEquip=!IsEquip)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const equipIdx = MAX_INVENTORY + 9;
    player.m_Inventory[equipIdx] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc, unequipCalled, equipCalled } = makeSvc({ getItem: (id) => table.get(id) });

    const r = svc.use(player, equipIdx, -1);

    assert.equal(r.kind, 'equip');
    assert.equal(r.kind === 'equip' && r.unequip, true);
    assert.equal(unequipCalled(), 9, 'unequip called with parts=9');
    assert.equal(equipCalled(), false, 'equip must not run for an equipped item');
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

  it('routes an IK3_PET item to the pet toggle, spending no charge', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[2] = { itemId: 21000, count: 1, objid: 2 };
    const table = new Map<number, ItemDefinition>([
      [21000, { id: 21000, name: 'Baby Lawolf', name_id: 'ITEM_P', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind2: 'IK2_GENERAL', item_kind3: 'IK3_PET', link_kind: 720 } as ItemDefinition],
    ]);
    const calls: Array<{ itemObjid: number; linkKind: number }> = [];
    const { svc, consumeCalled } = makeSvc({
      getItem: (id) => table.get(id),
      togglePet: (_p, itemObjid, linkKind) => { calls.push({ itemObjid, linkKind }); return true; },
    });

    const r = svc.use(player, 2, 0);
    assert.equal(r.kind, 'pet');
    assert.deepEqual(calls, [{ itemObjid: 2, linkKind: 720 }], 'toggle got the item objid + link_kind');
    assert.equal(consumeCalled(), false, 'pet items are bPermanence -- no charge spent');
  });

  it('rejects an IK3_PET item with no link_kind instead of consuming it', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[2] = { itemId: 21001, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [21001, { id: 21001, name: 'Broken Pet', name_id: 'ITEM_P2', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind3: 'IK3_PET' }],
    ]);
    const { svc, consumeCalled } = makeSvc({ getItem: (id) => table.get(id) });

    assert.equal(svc.use(player, 2, 0).kind, 'reject');
    assert.equal(consumeCalled(), false);
  });

  it('rejects an IK3_PET item when no pet system is wired (togglePet absent)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[2] = { itemId: 21000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [21000, { id: 21000, name: 'Baby Lawolf', name_id: 'ITEM_P', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, item_kind3: 'IK3_PET', link_kind: 720 } as ItemDefinition],
    ]);
    const { svc, consumeCalled } = makeSvc({ getItem: (id) => table.get(id) });

    assert.equal(svc.use(player, 2, 0).kind, 'reject');
    assert.equal(consumeCalled(), false, 'still no charge spent');
  });
});
