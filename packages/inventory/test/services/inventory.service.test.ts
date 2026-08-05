/**
 * InventoryService test -- addItem slotting + bag-full, addGold clamp, and the
 * WAL-before-persist ordering (rule 03/04).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { InventoryService } from '../../src/services/inventory.service';
import { MAX_GOLD } from '@flyff/core';
import { MAX_INVENTORY } from '@flyff/world-core';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

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

/** Call-order recorder: push a tag each time a dep method runs. */
function makeDeps() {
  const order: string[] = [];
  const setItemCalls: Array<{ charId: number; slot: number; itemId: number; quantity: number }> = [];
  const goldCalls: number[] = [];
  const journalCalls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  return {
    order,
    deps: {
      inventoryRepo: {
        setItem: async (charId: number, slot: number, itemId: number, quantity: number) => {
          order.push('setItem');
          setItemCalls.push({ charId, slot, itemId, quantity });
        },
        setGold: async (_charId: number, gold: number) => {
          order.push('setGold');
          goldCalls.push(gold);
        },
      },
      journal: {
        append: (entry: { type: string; payload: Record<string, unknown> }) => {
          order.push('journal:' + entry.type);
          journalCalls.push(entry);
        },
      },
    },
    setItemCalls,
    goldCalls,
    journalCalls,
  };
}

describe('InventoryService', () => {
  it('addItem places into the first empty main-bag slot, WAL before persist', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const ctx = makeDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.addItem(player, 2950, 1);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 1);
      assert.equal(r.changes[0]!.slot, 0, 'first empty slot');
      assert.equal(r.changes[0]!.itemId, 2950);
    }
    assert.deepEqual(player.m_Inventory[0], { objid: 0, itemId: 2950, count: 1 });
    assert.ok(player._dirty.has('m_Inventory'));

    // setItem is fire-and-forget; flush its microtask then assert ordering.
    await Promise.resolve();
    assert.deepEqual(ctx.order, ['journal:INVENTORY_SLOT', 'setItem'], 'journal before repo write');
    assert.equal(ctx.setItemCalls[0]!.slot, 0);
  });

  it('addItem returns bag_full when every main-bag slot is occupied', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    for (let i = 0; i < MAX_INVENTORY; i++) player.m_Inventory[i] = { itemId: 1, count: 1 };
    const ctx = makeDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.addItem(player, 2950, 1);

    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'bag_full');
    assert.equal(ctx.setItemCalls.length, 0, 'no persist on full bag');
    assert.equal(ctx.journalCalls.length, 0, 'no journal on full bag (rejected before WAL)');
  });

  it('addItem rejects non-positive count without touching state', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const ctx = makeDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.addItem(player, 2950, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'invalid');
    assert.equal(player.m_Inventory[0], null);
  });

  it('addGold clamps to MAX_GOLD + journals CHAR_GOLD (absolute) before persist', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = MAX_GOLD - 100;
    const ctx = makeDeps();
    const svc = new InventoryService(ctx.deps);

    svc.addGold(player, 500); // would overflow by 400

    assert.equal(player.m_nGold, MAX_GOLD, 'clamped, no overflow');
    assert.ok(player._dirty.has('m_nGold'));
    await Promise.resolve();
    assert.deepEqual(ctx.order, ['journal:CHAR_GOLD', 'setGold']);
    assert.equal(ctx.goldCalls[0], MAX_GOLD);
    assert.equal(ctx.journalCalls[0]!.payload.gold, MAX_GOLD, 'absolute gold total in payload');
  });
});

/** Richer dep mock: stacking + move + drop + consume. */
function makeFullDeps(stackSizeFor: (id: number) => number = () => 1) {
  const setItem: Array<{ slot: number; itemId: number; quantity: number }> = [];
  const removed: number[] = [];
  const moved: Array<{ src: number; dst: number }> = [];
  const gold: number[] = [];
  const journal: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const deps = {
    inventoryRepo: {
      setItem: async (_c: number, slot: number, itemId: number, quantity: number) => setItem.push({ slot, itemId, quantity }),
      removeItem: async (_c: number, slot: number) => removed.push(slot),
      updateQuantity: async () => {},
      moveItem: async (_c: number, src: number, dst: number) => moved.push({ src, dst }),
      setGold: async (_c: number, g: number) => gold.push(g),
    },
    journal: { append: (e: { type: string; payload: Record<string, unknown> }) => journal.push(e) },
    getStackSize: stackSizeFor,
  };
  return { deps, setItem, removed, moved, gold, journal };
}

describe('InventoryService -- stacking', () => {
  it('merges onto an existing partial stack (isNew=false)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 40 };
    const ctx = makeFullDeps(() => 99);
    const svc = new InventoryService(ctx.deps);

    const r = svc.addItem(player, 2001, 10);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 1);
      assert.equal(r.changes[0]!.isNew, false, 'merged, not a new slot');
      assert.equal(r.changes[0]!.slot, 0);
      assert.equal(r.changes[0]!.count, 50);
    }
    assert.equal(player.m_Inventory[0]!.count, 50);
  });

  it('takes a fresh slot when no partial stack exists (isNew=true)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const ctx = makeFullDeps(() => 99);
    const svc = new InventoryService(ctx.deps);

    const r = svc.addItem(player, 2001, 5);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 1);
      assert.equal(r.changes[0]!.isNew, true);
    }
    assert.equal(player.m_Inventory[0]!.count, 5);
  });

  it('remainder overflows into a new slot when partial stack is filled', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 15, objid: 0 };
    const ctx = makeFullDeps(() => 20);
    const svc = new InventoryService(ctx.deps);

    // 15/20 existing + add 10 -> fills to 20 (5 merged), remainder 5 -> new slot
    const r = svc.addItem(player, 2001, 10);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 2, 'two slots touched');
      assert.equal(r.changes[0]!.isNew, false, 'first change merges');
      assert.equal(r.changes[0]!.slot, 0);
      assert.equal(r.changes[0]!.count, 20, 'filled to stack_size');
      assert.equal(r.changes[1]!.isNew, true, 'second change is new slot');
      assert.equal(r.changes[1]!.count, 5, 'remainder placed');
    }
    assert.equal(player.m_Inventory[0]!.count, 20);
    assert.equal(player.m_Inventory[1]!.count, 5);
  });

  it('fills multiple partial stacks before placing in empty slots', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 5, objid: 0 };
    player.m_Inventory[3] = { itemId: 2001, count: 10, objid: 3 };
    const ctx = makeFullDeps(() => 20);
    const svc = new InventoryService(ctx.deps);

    // two partials: 5/20 (space 15) + 10/20 (space 10) = 25 space. Add 12.
    const r = svc.addItem(player, 2001, 12);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 1, 'only first partial needed (12 <= 15)');
      assert.equal(r.changes[0]!.isNew, false);
      assert.equal(r.changes[0]!.slot, 0);
      assert.equal(r.changes[0]!.count, 17, '5 + 12 = 17');
    }
    assert.equal(player.m_Inventory[0]!.count, 17);
    assert.equal(player.m_Inventory[3]!.count, 10, 'second partial untouched');
  });

  it('skips full stacks and places in empty slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 20, objid: 0 }; // full
    const ctx = makeFullDeps(() => 20);
    const svc = new InventoryService(ctx.deps);

    const r = svc.addItem(player, 2001, 5);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 1);
      assert.equal(r.changes[0]!.isNew, true, 'new slot because existing is full');
      assert.equal(r.changes[0]!.slot, 1);
    }
    assert.equal(player.m_Inventory[0]!.count, 20, 'full stack unchanged');
    assert.equal(player.m_Inventory[1]!.count, 5, 'new slot');
  });

  it('split-count items fill multiple new slots when stack_size < count', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const ctx = makeFullDeps(() => 10);
    const svc = new InventoryService(ctx.deps);

    // stack_size=10, add 25 -> 3 slots: 10 + 10 + 5
    const r = svc.addItem(player, 2001, 25);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.changes.length, 3);
      assert.equal(r.changes[0]!.count, 10);
      assert.equal(r.changes[1]!.count, 10);
      assert.equal(r.changes[2]!.count, 5);
      assert.ok(r.changes.every((c) => c.isNew), 'all new slots');
    }
  });
});

describe('InventoryService -- moveItem / dropItem / dropGold', () => {
  it('moveItem swaps two main-bag slots', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 100, count: 1 };
    player.m_Inventory[2] = { itemId: 200, count: 1 };
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.moveItem(player, 1, 2);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[1]!.itemId, 200);
    assert.equal(player.m_Inventory[2]!.itemId, 100);
    assert.deepEqual(ctx.moved[0], { src: 1, dst: 2 });
  });

  it('moveItem rejects equip-range slots', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);
    assert.equal(svc.moveItem(player, 0, MAX_INVENTORY).ok, false);
    assert.equal(svc.moveItem(player, 0, 0).ok, false, 'src===dst');
  });

  it('moveItem merges src fully into a partial dst stack (CItemContainer::Swap)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 2001, count: 5, objid: 1 };
    player.m_Inventory[2] = { itemId: 2001, count: 10, objid: 2 };
    const ctx = makeFullDeps(() => 99);
    const svc = new InventoryService(ctx.deps);

    const r = svc.moveItem(player, 1, 2);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[1], null, 'src emptied after full merge');
    assert.equal(player.m_Inventory[2]!.itemId, 2001);
    assert.equal(player.m_Inventory[2]!.count, 15, 'dst absorbed the full src count');
    assert.equal(ctx.removed[0], 1, 'src row removed from DB');
    assert.deepEqual(ctx.setItem[0], { slot: 2, itemId: 2001, quantity: 15 });
  });

  it('moveItem partial-merges when src exceeds dst space, leaving remainder in src', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    // dst 15/20 (space 5), src 10 -- only 5 merge, 5 remain in src.
    player.m_Inventory[1] = { itemId: 2001, count: 10, objid: 1 };
    player.m_Inventory[2] = { itemId: 2001, count: 15, objid: 2 };
    const ctx = makeFullDeps(() => 20);
    const svc = new InventoryService(ctx.deps);

    const r = svc.moveItem(player, 1, 2);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[1]!.count, 5, 'remainder stays in src');
    assert.equal(player.m_Inventory[2]!.count, 20, 'dst filled to stack_size');
    assert.equal(ctx.moved.length, 0, 'no pure-swap persist on a merge');
    assert.deepEqual(ctx.setItem[0], { slot: 2, itemId: 2001, quantity: 20 });
    assert.deepEqual(ctx.setItem[1], { slot: 1, itemId: 2001, quantity: 5 });
  });

  it('moveItem does NOT merge when flags differ (rarity/element bits)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 2001, count: 5, objid: 1, flags: 0x80 };
    player.m_Inventory[2] = { itemId: 2001, count: 10, objid: 2, flags: 0 };
    const ctx = makeFullDeps(() => 99);
    const svc = new InventoryService(ctx.deps);

    const r = svc.moveItem(player, 1, 2);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[1]!.itemId, 2001, 'no merge -- swap instead');
    assert.equal(player.m_Inventory[2]!.flags, 0x80);
    assert.deepEqual(ctx.moved[0], { src: 1, dst: 2 }, 'pure swap persisted');
  });

  it('moveItem does NOT merge non-stackable items (stack_size 1)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[1] = { itemId: 2001, count: 1, objid: 1 };
    player.m_Inventory[2] = { itemId: 2001, count: 1, objid: 2 };
    const ctx = makeFullDeps(() => 1);
    const svc = new InventoryService(ctx.deps);

    const r = svc.moveItem(player, 1, 2);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[1]!.itemId, 2001, 'non-stackable -> swap');
    assert.deepEqual(ctx.moved[0], { src: 1, dst: 2 });
  });

  it('dropItem partial-decrements the stack', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 10 };
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.dropItem(player, 0, 4, { x: 1, y: 2, z: 3 });

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.count, 4);
      assert.equal(r.itemId, 2001);
      assert.equal(r.slot, 0);
      assert.equal(r.remaining, 6, 'remaining = post-drop stack count');
    }
    assert.equal(player.m_Inventory[0]!.count, 6, 'remainder stays in bag');
  });

  it('dropItem full-stack clears the slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 3 };
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.dropItem(player, 0, 3, { x: 0, y: 0, z: 0 });

    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.remaining, 0, 'full drop leaves 0 behind');
    assert.equal(player.m_Inventory[0], null);
    assert.equal(ctx.removed[0], 0, 'row removed from DB');
  });

  it('dropGold subtracts and rejects over-spend', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 500;
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    const ok = svc.dropGold(player, 200, { x: 0, y: 0, z: 0 });
    assert.equal(ok.ok, true);
    assert.equal(player.m_nGold, 300);

    const bad = svc.dropGold(player, 999, { x: 0, y: 0, z: 0 });
    assert.equal(bad.ok, false, 'rejects more than held');
  });
});

describe('InventoryService -- removeItem (REMOVEINVENITEM)', () => {
  it('partial-remove decrements the stack + journals absolute end-state', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 10 };
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.removeItem(player, 0, 4);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.slot, 0);
      assert.equal(r.itemId, 2001);
      assert.equal(r.remaining, 6);
    }
    assert.equal(player.m_Inventory[0]!.count, 6, 'remainder stays in bag');
    assert.ok(player._dirty.has('m_Inventory'));
    await Promise.resolve();
    assert.deepEqual(
      ctx.journal[0],
      { charId: 1, type: 'INVENTORY_SLOT', payload: { slot: 0, itemId: 2001, count: 6 } },
      'canonical absolute end-state (itemId nonzero)',
    );
    assert.deepEqual(ctx.setItem[0], { slot: 0, itemId: 2001, quantity: 6 });
    assert.equal(ctx.removed.length, 0, 'no row delete on partial');
  });

  it('full-remove clears the slot + journals itemId 0 (clear signal)', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 3 };
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    const r = svc.removeItem(player, 0, 3);

    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.remaining, 0);
    assert.equal(player.m_Inventory[0], null, 'slot nulled in memory');
    await Promise.resolve();
    assert.equal(ctx.journal[0]!.payload.itemId, 0, 'itemId 0 => replayer removes row');
    assert.equal(ctx.removed[0], 0, 'row deleted from DB');
  });

  it('rejects non-positive count, over-count, empty slot, and equip-range slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2001, count: 10 };
    const ctx = makeFullDeps();
    const svc = new InventoryService(ctx.deps);

    assert.equal(svc.removeItem(player, 0, 0).ok, false, 'nNum <= 0');
    assert.equal(svc.removeItem(player, 0, 99).ok, false, 'nNum > stack');
    assert.equal(svc.removeItem(player, 5, 1).ok, false, 'empty slot');
    assert.equal(svc.removeItem(player, MAX_INVENTORY, 1).ok, false, 'equip-range slot (IsEquip gate)');
    assert.equal(ctx.removed.length, 0, 'no mutation on any reject');
    assert.equal(ctx.setItem.length, 0);
    assert.equal(ctx.journal.length, 0, 'no WAL on rejected paths');
    assert.equal(player.m_Inventory[0]!.count, 10, 'stack untouched');
  });
});

describe('InventoryService.canFit (pet-only IsLoot bag-full filter)', () => {
  it('true on an empty bag', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const svc = new InventoryService(makeFullDeps().deps);
    assert.equal(svc.canFit(player, 2001, 1), true);
  });

  it('false when every main-bag slot is occupied and nothing stacks', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    for (let i = 0; i < MAX_INVENTORY; i++) player.m_Inventory[i] = { itemId: 1, count: 1 };
    const svc = new InventoryService(makeFullDeps().deps);
    assert.equal(svc.canFit(player, 2001, 1), false);
  });

  it('true on a full bag when a partial stack of the same item has room', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    for (let i = 0; i < MAX_INVENTORY; i++) player.m_Inventory[i] = { itemId: 1, count: 1 };
    player.m_Inventory[5] = { itemId: 2001, count: 90 };
    const svc = new InventoryService(makeFullDeps(() => 99).deps);
    assert.equal(svc.canFit(player, 2001, 9), true, '9 fits the 90/99 stack');
    assert.equal(svc.canFit(player, 2001, 10), false, '10 overflows with no empty slot left');
  });

  it('false for a non-positive count', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const svc = new InventoryService(makeFullDeps().deps);
    assert.equal(svc.canFit(player, 2001, 0), false);
  });
});
