/**
 * AmmoService tests -- `CMover::IsBullet` gate, `ArrowDown` burn + auto-re-equip,
 * and `IsEquipAble`'s arrow-needs-bow equip gate.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AmmoService } from '../../src/services/ammo.service';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import type { ItemDefinition } from '@flyff/resources';

const MAX_INVENTORY = 42;
const PARTS_RWEAPON = 10;
const PARTS_BULLET = 25;
const AMMO = MAX_INVENTORY + PARTS_BULLET; // 67
const HAND = MAX_INVENTORY + PARTS_RWEAPON; // 52

const ARROW_ID = 2028;
const BOW_ID = 3000;
const SWORD_ID = 3001;

const props: Record<number, Partial<ItemDefinition>> = {
  [ARROW_ID]: { item_kind3: 'IK3_ARROW' },
  [BOW_ID]: { item_kind3: 'IK3_BOW' },
  [SWORD_ID]: { item_kind3: 'IK3_SWORD' },
};

function slot(itemId: number, count: number, objid: number): InventorySlot {
  return { itemId, count, objid } as InventorySlot;
}

function makePlayer(): CPlayer {
  const inv: (InventorySlot | null)[] = new Array(MAX_INVENTORY + 32).fill(null);
  return {
    m_idPlayer: 7,
    m_Inventory: inv,
    _dirty: new Set<string>(),
    onEquipIndexMove: () => {},
  } as unknown as CPlayer;
}

function makeSvc() {
  const calls = {
    journal: [] as { slot: number; itemId: number; count: number }[],
    setItem: [] as number[],
    removeItem: [] as number[],
    sent: 0,
    broadcast: 0,
  };
  const svc = new AmmoService({
    inventoryRepo: {
      setItem: async (_c: number, s: number) => { calls.setItem.push(s); },
      removeItem: async (_c: number, s: number) => { calls.removeItem.push(s); },
    } as never,
    getItem: (id: number) => props[id] as ItemDefinition | undefined,
    sendTo: () => { calls.sent++; },
    broadcastAround: () => { calls.broadcast++; },
    journal: {
      append: (e: { payload: unknown }) => {
        calls.journal.push(e.payload as { slot: number; itemId: number; count: number });
      },
    } as never,
  });
  return { svc, calls };
}

describe('AmmoService.hasArrow', () => {
  it('is false when the ammo slot is empty', () => {
    const { svc } = makeSvc();
    assert.equal(svc.hasArrow(makePlayer()), false);
  });

  it('is false when the ammo slot holds a non-arrow item', () => {
    const { svc } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(SWORD_ID, 1, 100);
    assert.equal(svc.hasArrow(p), false);
  });

  it('is false when the arrow stack is empty (count 0)', () => {
    const { svc } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(ARROW_ID, 0, 100);
    assert.equal(svc.hasArrow(p), false);
  });

  it('is true for an IK3_ARROW stack', () => {
    const { svc } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(ARROW_ID, 5, 100);
    assert.equal(svc.hasArrow(p), true);
  });
});

describe('AmmoService.arrowDown', () => {
  it('decrements the stack, journals absolute end-state, echoes the count', () => {
    const { svc, calls } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(ARROW_ID, 10, 100);
    svc.arrowDown(p, 1);
    assert.equal(p.m_Inventory[AMMO]?.count, 9);
    assert.deepEqual(calls.journal, [{ slot: AMMO, itemId: ARROW_ID, count: 9 }]);
    assert.deepEqual(calls.setItem, [AMMO]);
    assert.equal(calls.sent, 1, 'one UPDATE_ITEM echo');
    assert.equal(calls.broadcast, 0, 'no DOEQUIP while the stack survives');
    assert.ok(p._dirty.has('m_Inventory'));
  });

  it('is a no-op when nothing is equipped', () => {
    const { svc, calls } = makeSvc();
    svc.arrowDown(makePlayer(), 1);
    assert.deepEqual(calls.journal, []);
    assert.equal(calls.sent, 0);
  });

  it('clears the slot on exhaustion and promotes the next same-item bag stack', () => {
    const { svc, calls } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(ARROW_ID, 1, 100);
    p.m_Inventory[3] = slot(ARROW_ID, 999, 101);
    svc.arrowDown(p, 1);
    assert.equal(p.m_Inventory[3], null, 'bag stack moved out');
    assert.equal(p.m_Inventory[AMMO]?.itemId, ARROW_ID);
    assert.equal(p.m_Inventory[AMMO]?.count, 999);
    assert.deepEqual(calls.journal, [
      { slot: AMMO, itemId: 0, count: 0 },
      { slot: 3, itemId: 0, count: 0 },
      { slot: AMMO, itemId: ARROW_ID, count: 999 },
    ]);
    assert.equal(calls.broadcast, 1, 'auto-re-equip DOEQUIP broadcast');
  });

  it('leaves the slot empty on exhaustion when the bag has no more of that item', () => {
    const { svc, calls } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(ARROW_ID, 1, 100);
    svc.arrowDown(p, 1);
    assert.equal(p.m_Inventory[AMMO], null);
    assert.deepEqual(calls.journal, [{ slot: AMMO, itemId: 0, count: 0 }]);
    assert.deepEqual(calls.removeItem, [AMMO]);
    assert.equal(calls.broadcast, 0);
  });

  it('ignores a non-positive burn count', () => {
    const { svc, calls } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[AMMO] = slot(ARROW_ID, 10, 100);
    svc.arrowDown(p, 0);
    assert.equal(p.m_Inventory[AMMO]?.count, 10);
    assert.deepEqual(calls.journal, []);
  });
});

describe('AmmoService.isArrowEquipAllowed', () => {
  it('allows any non-arrow prop', () => {
    const { svc } = makeSvc();
    assert.equal(svc.isArrowEquipAllowed(makePlayer(), props[SWORD_ID] as ItemDefinition), true);
  });

  it('refuses an arrow with an empty right hand', () => {
    const { svc } = makeSvc();
    assert.equal(svc.isArrowEquipAllowed(makePlayer(), props[ARROW_ID] as ItemDefinition), false);
  });

  it('refuses an arrow when the right hand holds a non-bow', () => {
    const { svc } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[HAND] = slot(SWORD_ID, 1, 200);
    assert.equal(svc.isArrowEquipAllowed(p, props[ARROW_ID] as ItemDefinition), false);
  });

  it('allows an arrow when the right hand holds an IK3_BOW', () => {
    const { svc } = makeSvc();
    const p = makePlayer();
    p.m_Inventory[HAND] = slot(BOW_ID, 1, 200);
    assert.equal(svc.isArrowEquipAllowed(p, props[ARROW_ID] as ItemDefinition), true);
  });
});
