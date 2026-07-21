/**
 * InventoryService test — addItem slotting + bag-full, addGold clamp, and the
 * WAL-before-persist ordering (rule 03/04).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { InventoryService } from '../../src/services/inventory.service.js';
import { MAX_GOLD } from '@flyff/core';
import { MAX_INVENTORY } from '../../src/net/snapshot/constants.js';
import { CPlayer } from '../../src/entities/player.js';
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
      },
      charRepo: {
        updateGold: async (charId: number, gold: number) => {
          order.push('updateGold');
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
      assert.equal(r.slot, 0, 'first empty slot');
      assert.equal(r.itemId, 2950);
    }
    assert.deepEqual(player.m_Inventory[0], { itemId: 2950, count: 1 });
    assert.ok(player._dirty.has('m_Inventory'));

    // setItem is fire-and-forget; flush its microtask then assert ordering.
    await Promise.resolve();
    assert.deepEqual(ctx.order, ['journal:ITEM_PICKUP', 'setItem'], 'journal before repo write');
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

  it('addGold clamps to MAX_GOLD + journals GOLD_GAIN before persist', async () => {
    const player = CPlayer.fromRow(makeRow({ gold: MAX_GOLD - 100 }), { write: () => true });
    const ctx = makeDeps();
    const svc = new InventoryService(ctx.deps);

    svc.addGold(player, 500); // would overflow by 400

    assert.equal(player.m_nGold, MAX_GOLD, 'clamped, no overflow');
    assert.ok(player._dirty.has('m_nGold'));
    await Promise.resolve();
    assert.deepEqual(ctx.order, ['journal:GOLD_GAIN', 'updateGold']);
    assert.equal(ctx.goldCalls[0], MAX_GOLD);
    assert.equal(ctx.journalCalls[0]!.payload.amount, 100, 'gained only the pre-clamp delta');
  });
});
