/**
 * ShopService test -- vendor validation + open/close state.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MMI_TRADE } from '@flyff/resources';
import { ShopService } from '../../src/services/shop.service.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { SpawnManager } from '../../src/managers/spawn.manager.js';
import type { VendorStock } from '../../src/entities/mover.js';

/** One populated slot in tab 0 so we can assert the stock reference passes through. */
const STOCK: VendorStock = Object.freeze([
  Object.freeze([{ itemId: 81, count: 1 }, null]),
  Object.freeze([null]),
  Object.freeze([null]),
  Object.freeze([null]),
]) as VendorStock;

function makePlayer(): CPlayer {
  return { m_idPlayer: 1, m_bBankOpen: false, m_idOther: null } as unknown as CPlayer;
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

describe('ShopService', () => {
  it('opens for a trade NPC with MMI_TRADE', () => {
    const svc = new ShopService({ spawnManager: makeSpawnManager({ 100: { id: 100, menus: [MMI_TRADE] } }) });
    const res = svc.open(makePlayer(), 100);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.vendorId, 100);
  });

  it('returns the vendor stock on open for the serializer to render', () => {
    const svc = new ShopService({ spawnManager: makeSpawnManager({ 100: { id: 100, menus: [MMI_TRADE], stock: STOCK } }) });
    const res = svc.open(makePlayer(), 100);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.stock, STOCK, 'stock reference passes through unchanged');
  });

  it('rejects an unknown objid', () => {
    const svc = new ShopService({ spawnManager: makeSpawnManager({}) });
    assert.equal(svc.open(makePlayer(), 999).ok, false);
  });

  it('rejects a monster (no MMI_TRADE menu)', () => {
    const svc = new ShopService({ spawnManager: makeSpawnManager({ 7: { id: 7, menus: [] } }) });
    const res = svc.open(makePlayer(), 7);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'not_vendor');
  });

  it('rejects while the bank window is open', () => {
    const svc = new ShopService({ spawnManager: makeSpawnManager({ 100: { id: 100, menus: [MMI_TRADE] } }) });
    const p = makePlayer();
    p.m_bBankOpen = true;
    const res = svc.open(p, 100);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'busy');
  });

  it('replaces a stale m_idOther when opening a different vendor', () => {
    // The v15 client doesn't always send CLOSESHOPWND around the piercing/upgrade
    // transition at a weapon shop, so m_idOther can stick. A new OPENSHOPWND must
    // self-heal that instead of permanently locking the player out of all shops.
    const svc = new ShopService({
      spawnManager: makeSpawnManager({
        100: { id: 100, menus: [MMI_TRADE] },
        200: { id: 200, menus: [MMI_TRADE] },
      }),
    });
    const p = makePlayer();
    p.m_idOther = 55; // stale vendor left over from a shop that never closed
    const res = svc.open(p, 200);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.vendorId, 200);
    assert.equal(p.m_idOther, 200);
  });

  it('clears m_idOther on close', () => {
    const svc = new ShopService({ spawnManager: makeSpawnManager({ 100: { id: 100, menus: [MMI_TRADE] } }) });
    const p = makePlayer();
    assert.ok(svc.open(p, 100).ok);
    assert.equal(p.m_idOther, 100);
    svc.close(p);
    assert.equal(p.m_idOther, null);
  });
});
