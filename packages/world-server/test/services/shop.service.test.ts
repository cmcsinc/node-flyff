/**
 * ShopService test -- vendor validation, open/close state, buy + sell.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MMI_TRADE } from '@flyff/resources';
import { ShopService } from '../../src/services/shop.service';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import type { SpawnManager } from '@flyff/world-core';
import type { InventoryService } from '../../src/services/inventory.service';
import type { VendorStock } from '@flyff/entities';

/** One populated slot (itemId 81) in tab 0/slot 0 for buy happy-path. */
const STOCK: VendorStock = Object.freeze([
  Object.freeze([{ itemId: 81, count: 1 }, null]),
  Object.freeze([null]),
  Object.freeze([null]),
  Object.freeze([null]),
]) as VendorStock;

/** propItem table: 81 trades at price 10; 82 is unsellable. */
const ITEM_DEFS: Record<number, { price?: number; sellable?: boolean }> = {
  81: { price: 10, sellable: true },
  82: { price: 20, sellable: false },
};

function makePlayer(overrides: Partial<CPlayer> = {}): CPlayer {
  return {
    m_idPlayer: 1,
    m_accountId: 1,
    m_nGold: 1000,
    m_bBankOpen: false,
    m_idOther: null,
    m_Inventory: new Array(42).fill(null),
    _dirty: new Set<string>(),
    findSlotByObjId(objid: number): number {
      const inv = this.m_Inventory as (InventorySlot | null)[];
      for (let i = 0; i < inv.length; i++) if (inv[i] && inv[i]!.objid === objid) return i;
      if (objid >= 0 && objid < inv.length && inv[objid]) return objid;
      return -1;
    },
    ...overrides,
  } as unknown as CPlayer;
}

function makeSpawnManager(
  vendors: Record<number, { id: number; menus: number[]; stock?: VendorStock }>,
): SpawnManager {
  return {
    get: (id: number) =>
      vendors[id] && {
        m_idMover: vendors[id]!.id,
        m_abMoverMenu: vendors[id]!.menus,
        m_vendorStock: vendors[id]!.stock ?? [],
      },
  } as unknown as SpawnManager;
}

/** Recordable inventory mock -- captures addItem/consume/addGold/spendGold. */
function makeInventoryService(inv: {
  addItem?: InventoryService['addItem'];
  consume?: InventoryService['consume'];
}): InventoryService {
  return {
    addItem: inv.addItem ?? (() => ({ ok: false, reason: 'bag_full' })),
    consume: inv.consume ?? (() => null),
    addGold: (player, amount) => { if (amount > 0) player.m_nGold += amount; },
    spendGold: (player, amount) => {
      if (amount <= 0 || amount > player.m_nGold) return false;
      player.m_nGold -= amount;
      return true;
    },
  } as unknown as InventoryService;
}

/** Build a ShopService wired to a vendor + a deterministic inventory mock. */
function makeSvc(
  vendors: Record<number, { id: number; menus: number[]; stock?: VendorStock }>,
  inv: { addItem?: InventoryService['addItem']; consume?: InventoryService['consume'] } = {},
): ShopService {
  return new ShopService({
    spawnManager: makeSpawnManager(vendors),
    inventoryService: makeInventoryService(inv),
    getItem: (id: number) => ITEM_DEFS[id],
  });
}

/** Simulate addItem landing in a fresh slot. */
function addOk(slot = 0): InventoryService['addItem'] {
  return ((player, itemId, count) => {
    (player.m_Inventory as (InventorySlot | null)[])[slot] = { itemId, count };
    return { ok: true, slot, itemId, count, isNew: true };
  }) as InventoryService['addItem'];
}

/** Simulate consume decrementing/clearing a slot. */
function consumeReal(): InventoryService['consume'] {
  return ((player, slot, count = 1) => {
    const arr = player.m_Inventory as (InventorySlot | null)[];
    const s = arr[slot];
    if (!s) return null;
    s.count -= count;
    if (s.count <= 0) arr[slot] = null;
    return arr[slot];
  }) as InventoryService['consume'];
}

describe('ShopService -- open/close', () => {
  it('opens for a trade NPC with MMI_TRADE', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE] } });
    const res = svc.open(makePlayer(), 100);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.vendorId, 100);
  });

  it('returns the vendor stock on open for the serializer to render', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } });
    const res = svc.open(makePlayer(), 100);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.stock, STOCK, 'stock reference passes through unchanged');
  });

  it('rejects an unknown objid', () => {
    assert.equal(makeSvc({}).open(makePlayer(), 999).ok, false);
  });

  it('rejects a monster (no MMI_TRADE menu)', () => {
    const res = makeSvc({ 7: { id: 7, menus: [] } }).open(makePlayer(), 7);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'not_vendor');
  });

  it('rejects while the bank window is open', () => {
    const p = makePlayer({ m_bBankOpen: true });
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE] } }).open(p, 100);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'busy');
  });

  it('replaces a stale m_idOther when opening a different vendor', () => {
    const svc = makeSvc({
      100: { id: 100, menus: [MMI_TRADE] },
      200: { id: 200, menus: [MMI_TRADE] },
    });
    const p = makePlayer({ m_idOther: 55 });
    const res = svc.open(p, 200);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.vendorId, 200);
    assert.equal(p.m_idOther, 200);
  });

  it('clears m_idOther on close', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE] } });
    const p = makePlayer();
    assert.ok(svc.open(p, 100).ok);
    svc.close(p);
    assert.equal(p.m_idOther, null);
  });
});

describe('ShopService -- buy', () => {
  it('delivers the item + deducts gold on a valid buy', () => {
    let spent = 0;
    const svc = new ShopService({
      spawnManager: makeSpawnManager({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }),
      inventoryService: {
        ...makeInventoryService({ addItem: addOk(3) }),
        spendGold: (_p, amount) => { spent = amount; return true; },
      } as InventoryService,
      getItem: (id) => ITEM_DEFS[id],
    });
    const p = makePlayer({ m_idOther: 100, m_nGold: 1000 });
    const res = svc.buy(p, 0, 0, 5, 81); // 5 * price 10 = 50
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.slot, 3);
      assert.equal(res.itemId, 81);
      assert.equal(res.count, 5);
      assert.equal(spent, 50);
      assert.equal(res.gold, 1000); // mock spendGold doesn't mutate m_nGold
    }
  });

  it('rejects when no vendor is set (m_idOther null)', () => {
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { addItem: addOk() })
      .buy(makePlayer({ m_idOther: null }), 0, 0, 1, 81);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'no_vendor');
  });

  it('rejects a count <= 0', () => {
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { addItem: addOk() })
      .buy(makePlayer({ m_idOther: 100 }), 0, 0, 0, 81);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'invalid');
  });

  it('rejects a dwItemId that does not match the stock slot (anti-cheat)', () => {
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { addItem: addOk() })
      .buy(makePlayer({ m_idOther: 100 }), 0, 0, 1, 999);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'no_stock');
  });

  it('rejects when the player lacks the gold', () => {
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { addItem: addOk() })
      .buy(makePlayer({ m_idOther: 100, m_nGold: 5 }), 0, 0, 1, 81); // price 10 > 5
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'no_gold');
  });

  it('rejects with bag_full and does not spend gold', () => {
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }) // addItem defaults to bag_full
      .buy(makePlayer({ m_idOther: 100, m_nGold: 1000 }), 0, 0, 1, 81);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'bag_full');
  });

  it('clamps nNum to what the gold can cover (matches C++ OnBuyItem)', () => {
    // gold 25, price 10 -> affordable 2 -> buys 2 (not the requested 5), cost 20.
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { addItem: addOk(3) });
    const p = makePlayer({ m_idOther: 100, m_nGold: 25 });
    const res = svc.buy(p, 0, 0, 5, 81);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.count, 2);
      assert.equal(res.gold, 5); // 25 - 20
    }
  });
});

describe('ShopService -- sell', () => {
  it('removes the stack + credits floor(price/4) per unit', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { consume: consumeReal() });
    const p = makePlayer({
      m_idOther: 100,
      m_Inventory: (() => { const a = new Array(42).fill(null); a[5] = { itemId: 81, count: 4 }; return a; })(),
    });
    const res = svc.sell(p, 5, 2); // floor(10/4)=2 per unit * 2 = 4
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.slot, 5);
      assert.equal(res.remaining, 2);
      assert.equal(res.gold, 1004); // 1000 + 4
    }
    assert.equal((p.m_Inventory as (InventorySlot | null)[])[5]!.count, 2);
  });

  it('clears the slot (UPDATE_ITEM count 0) when the whole stack is sold', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { consume: consumeReal() });
    const p = makePlayer({
      m_idOther: 100,
      m_Inventory: (() => { const a = new Array(42).fill(null); a[3] = { itemId: 81, count: 2 }; return a; })(),
    });
    const res = svc.sell(p, 3, 2);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.remaining, 0);
      assert.equal((p.m_Inventory as (InventorySlot | null)[])[3], null);
    }
  });

  it('rejects an unsellable item', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { consume: consumeReal() });
    const p = makePlayer({
      m_idOther: 100,
      m_Inventory: (() => { const a = new Array(42).fill(null); a[0] = { itemId: 82, count: 1 }; return a; })(),
    });
    const res = svc.sell(p, 0, 1);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'unsellable');
  });

  it('rejects an empty inventory slot', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { consume: consumeReal() });
    const res = svc.sell(makePlayer({ m_idOther: 100 }), 0, 1);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'empty');
  });

  it('rejects an objid not present in the inventory', () => {
    const svc = makeSvc({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }, { consume: consumeReal() });
    // Wire nId is a stable m_dwObjId, not a slot. 99 matches no slot's objid
    // and falls outside the bag range, so findSlotByObjId returns -1 -> empty.
    const res = svc.sell(makePlayer({ m_idOther: 100 }), 99, 1);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'empty');
  });

  it('rejects when no vendor is set', () => {
    const res = makeSvc({ 100: { id: 100, menus: [MMI_TRADE] } }, { consume: consumeReal() })
      .sell(makePlayer({ m_idOther: null }), 0, 1);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'no_vendor');
  });
});
