/**
 * RepairService tests -- cost calc, gold gate, indestructible skip, full repair.
 * @module services/repair.test
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { Journal, InventoryRepository, createDb } from '@flyff/database';
import type { Knex } from 'knex';
import { RepairService, type RepairServiceDeps } from '../../src/services/repair.service';
import type { CPlayer, InventorySlot } from '@flyff/entities';

const TMP = './.tmp-repair-test.sqlite3';

interface MockPlayer {
  m_idPlayer: number;
  m_nGold: number;
  m_Inventory: (InventorySlot | null)[];
  _dirty: Set<string>;
}
function makePlayer(gold = 100000): MockPlayer {
  return { m_idPlayer: 1, m_nGold: gold, m_Inventory: new Array(73).fill(null), _dirty: new Set() };
}

describe('RepairService', () => {
  let db: Knex;
  let repo: InventoryRepository;
  let journal: Journal;

  before(async () => {
    db = createDb({ client: 'better-sqlite3', connection: TMP });
    await db.schema.dropTableIfExists('inventory_item');
    await db.schema.dropTableIfExists('inventory');
    await db.schema.createTable('inventory_item', (t) => {
      t.increments('id').primary();
      t.integer('character_id').notNullable();
      t.integer('slot').notNullable();
      t.integer('item_id').notNullable();
      t.integer('quantity').notNullable();
      t.integer('flags').notNullable().defaultTo(0);
      t.integer('durability').notNullable().defaultTo(-1);
      t.integer('refine').notNullable().defaultTo(0);
      t.integer('element').notNullable().defaultTo(0);
      t.integer('element_level').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
    });
    await db.schema.createTable('inventory', (t) => {
      t.integer('character_id').primary();
      t.integer('gold').notNullable().defaultTo(0);
    });
    await db('inventory').insert({ character_id: 1, gold: 100000 });
    journal = new Journal({ path: ':memory:' });
    repo = new InventoryRepository(db);
  });

  function makeService(getItem: (id: number) => { durability?: number } | undefined, balance: number) {
    let gold = balance;
    const deps: RepairServiceDeps = {
      inventoryRepo: repo,
      journal,
      getItem,
      spendGold: (_p, amt) => {
        if (amt > gold) return false;
        gold -= amt;
        return true;
      },
    };
    return { svc: new RepairService(deps), getGold: () => gold };
  }

  it('repairs a damaged item, debits gold, sets durability to max', () => {
    const player = makePlayer();
    player.m_Inventory[0] = { itemId: 100, count: 1, durability: 50, objid: 0x40000001 };
    const { svc } = makeService((id) => (id === 100 ? { durability: 100 } : undefined), 100000);
    const r = svc.repair(player as unknown as CPlayer, [0]);
    assert.ok(r.ok, 'should succeed');
    if (r.ok) {
      assert.equal(r.repaired.length, 1);
      assert.equal(r.repaired[0].durability, 100);
      assert.equal(player.m_Inventory[0]!.durability, 100, 'durability restored');
      assert.ok(r.cost > 0, 'cost assessed');
    }
  });

  it('skips indestructible items (durability === -1)', () => {
    const player = makePlayer();
    player.m_Inventory[1] = { itemId: 200, count: 1, durability: -1, objid: 0x40000002 };
    const { svc } = makeService(() => ({ durability: 100 }), 100000);
    const r = svc.repair(player as unknown as CPlayer, [1]);
    assert.ok(!r.ok && r.reason === 'empty');
  });

  it('skips already-full items', () => {
    const player = makePlayer();
    player.m_Inventory[2] = { itemId: 300, count: 1, durability: 100, objid: 0x40000003 };
    const { svc } = makeService((id) => (id === 300 ? { durability: 100 } : undefined), 100000);
    const r = svc.repair(player as unknown as CPlayer, [2]);
    assert.ok(!r.ok && r.reason === 'empty');
  });

  it('rejects on insufficient gold and does NOT mutate durability', () => {
    const player = makePlayer();
    player.m_Inventory[0] = { itemId: 100, count: 1, durability: 0, objid: 0x40000004 };
    const { svc } = makeService((id) => (id === 100 ? { durability: 100 } : undefined), 0);
    const r = svc.repair(player as unknown as CPlayer, [0]);
    assert.ok(!r.ok && r.reason === 'insufficient_gold');
    assert.equal(player.m_Inventory[0]!.durability, 0, 'untouched on reject');
  });
});
