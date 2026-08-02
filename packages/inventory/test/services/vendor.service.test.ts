/**
 * VendorService tests -- the private-shop (vending) state machine.
 *
 * Priority is the buy transaction: gold+item swap is dupe-safe (the listed bag
 * slot is re-validated at buy time), and the lackmoney/lackspace gates fire
 * before any mutation. Also covers open/register guards + disconnect teardown.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, VTInfo } from '@flyff/entities';
import type { InventorySlot } from '@flyff/entities';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { InventoryService } from '../../src/services/inventory.service';
import { VendorService } from '../../src/services/vendor.service';

interface Frame { readonly to: number; readonly buf: Buffer }
interface Ctx {
  svc: VendorService;
  sent: Frame[];
  broadcast: { from: number; buf: Buffer }[];
  journal: { type: string; charId: number; payload: unknown }[];
}

function makePlayer(charId: number, gold = 0): CPlayer {
  const p = Object.create(CPlayer.prototype) as CPlayer & {
    m_Inventory: unknown[]; _dirty: Set<string>;
  };
  p.m_idPlayer = charId;
  p.m_szName = `P${charId}`;
  p.m_nGold = gold;
  p.m_nDuel = 0;
  p.m_tmLastDamage = 0;
  p.m_nZoneId = 1;
  p.m_vPos = { x: 0, y: 0, z: 0 };
  p.m_Inventory = new Array(73).fill(null);
  // m_invIndex mirrors the client's m_apIndex (slot -> m_dwObjId). Real CPlayer
  // inits bag range identity; addItem reads it via clientObjId().
  const invIndex = new Array(73);
  for (let i = 0; i < 73; i++) invIndex[i] = i;
  Object.defineProperty(p, 'm_invIndex', { value: invIndex, writable: false });
  Object.defineProperty(p, 'm_vtInfo', { value: new VTInfo(), writable: false });
  Object.defineProperty(p, '_dirty', { value: new Set<string>(), writable: false });
  return p as unknown as CPlayer;
}

function setItem(p: CPlayer, slot: number, itemId: number, count: number): void {
  const inv = p.m_Inventory as (InventorySlot | null | undefined)[];
  inv[slot] = { itemId, count, objid: slot };
}

function makeCtx(players: readonly CPlayer[]): Ctx {
  const sent: Frame[] = [];
  const broadcast: { from: number; buf: Buffer }[] = [];
  const journal: { type: string; charId: number; payload: unknown }[] = [];
  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ to: p.m_idPlayer, buf }); },
    all: () => players as CPlayer[],
  } as unknown as ConstructorParameters<typeof VendorService>[0]['playerManager'];
  const zoneManager = {
    broadcastAround: (pos: unknown, zoneId: unknown, radius: unknown, buf: Buffer, except?: unknown) => {
      const from = (players.find((p) => p.m_vPos === pos) ?? players[0]) as CPlayer;
      broadcast.push({ from: from.m_idPlayer, buf });
    },
  } as unknown as ConstructorParameters<typeof VendorService>[0]['zoneManager'];
  const inventoryRepo = {
    setItem: async () => {},
    removeItem: async () => {},
    setGold: async () => {},
  } as unknown as ConstructorParameters<typeof InventoryService>[0]['inventoryRepo'];
  const journalObj = {
    append: (e: { charId: number; type: string; payload: unknown }) => journal.push(e),
  } as unknown as ConstructorParameters<typeof InventoryService>[0]['journal'];
  const stackSize = (id: number) => (id === 1 ? 99 : 1);
  const inventoryService = new InventoryService({
    playerManager, inventoryRepo, journal: journalObj,
    getStackSize: stackSize,
  });
  const svc = new VendorService({
    playerManager, zoneManager, inventoryService,
    getItemProp: (id: number) => ({ stack_size: stackSize(id), item_kind3: id === 9001 ? 'IK3_QUEST' : undefined }),
    sendDefinedText: (p, tid) => { sent.push({ to: p.m_idPlayer, buf: Buffer.from([tid]) }); },
    journal: journalObj,
  });
  return { svc, sent, broadcast, journal };
}

/** Decode a SNAPSHOT frame's leading objid + subtype. */
function openFrame(buf: Buffer): { objid: number; subtype: number } {
  const r = new PacketReader(buf);
  assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
  r.readDword();
  assert.equal(r.readWord(), 1);
  const objid = r.readDword();
  const subtype = r.readWord();
  return { objid, subtype };
}

const subtypes = (fs: readonly Frame[]): number[] => fs.map((f) => openFrame(f.buf).subtype);

describe('VendorService', () => {
  describe('open', () => {
    it('sets the title and broadcasts PVENDOR_OPEN once items are listed', () => {
      const v = makePlayer(1);
      setItem(v, 5, 100, 4);
      const ctx = makeCtx([v]);
      ctx.svc.registerItem(v, 0, 5, 2, 10);   // configure first (gate: !open)
      ctx.broadcast.length = 0;
      assert.deepEqual(ctx.svc.open(v, 'My Shop'), { ok: true });
      assert.equal(v.m_vtInfo.title, 'My Shop');
      assert.equal(v.m_vtInfo.vendorOpen, true);
      assert.equal(ctx.broadcast.length, 1);
      assert.equal(openFrame(ctx.broadcast[0]!.buf).subtype, SNAPSHOTTYPE.PVENDOR_OPEN);
    });

    it('open with no listings sets the title but does not broadcast', () => {
      const v = makePlayer(1);
      const ctx = makeCtx([v]);
      assert.deepEqual(ctx.svc.open(v, 'My Shop'), { ok: true });
      assert.equal(v.m_vtInfo.vendorOpen, true);
      assert.equal(ctx.broadcast.length, 0);   // C++ gates AddPVendorOpen on VendorIsVendor
    });

    it('refuses while busy (trading/browsing), in a duel, or attack-mode', () => {
      const v = makePlayer(1);
      const ctx = makeCtx([v]);
      v.m_vtInfo.otherId = 2;
      assert.equal(ctx.svc.open(v, 'x').ok, false);        // busy
      v.m_vtInfo.otherId = null;
      v.m_nDuel = 1;
      assert.equal(ctx.svc.open(v, 'x').ok, false);        // duel
      v.m_nDuel = 0;
      v.m_tmLastDamage = Date.now();
      assert.equal(ctx.svc.open(v, 'x').ok, false);        // attack-mode
      v.m_tmLastDamage = 0;
      assert.deepEqual(ctx.svc.open(v, 'ok'), { ok: true });
    });
  });

  describe('register', () => {
    it('creates a listing from a bag item and echoes REGISTER_PVENDOR_ITEM', () => {
      const v = makePlayer(1);
      setItem(v, 5, 100, 10);
      const ctx = makeCtx([v]);
      assert.deepEqual(ctx.svc.registerItem(v, 0, 5, 3, 500), { ok: true });
      const l = v.m_vtInfo.listings[0]!;
      assert.equal(l.bagSlot, 5);
      assert.equal(l.itemId, 100);
      assert.equal(l.count, 3);            // requested 3 of 10
      assert.equal(l.cost, 500);
      assert.equal(subtypes(ctx.sent)[0], SNAPSHOTTYPE.REGISTER_PVENDOR_ITEM);
    });

    it('refuses quest items, equipped slots, bad index, busy, and already-open', () => {
      const v = makePlayer(1);
      setItem(v, 2, 9001, 1);              // IK3_QUEST (getItemProp stub)
      setItem(v, 42, 100, 1);             // equipped range (>= MAX_INVENTORY)
      setItem(v, 5, 100, 1);
      const ctx = makeCtx([v]);
      assert.equal(ctx.svc.registerItem(v, 0, 2, 1, 1).ok, false);   // quest
      assert.equal(ctx.svc.registerItem(v, 0, 42, 1, 1).ok, false);  // equipped
      assert.equal(ctx.svc.registerItem(v, 99, 5, 1, 1).ok, false);  // bad index
      v.m_vtInfo.otherId = 9;
      assert.equal(ctx.svc.registerItem(v, 0, 5, 1, 1).ok, false);   // busy
      v.m_vtInfo.otherId = null;
      v.m_vtInfo.title = 'open';
      assert.equal(ctx.svc.registerItem(v, 0, 5, 1, 1).ok, false);   // already open
      v.m_vtInfo.title = '';
      assert.deepEqual(ctx.svc.registerItem(v, 0, 5, 1, 1), { ok: true });
    });
  });

  describe('buy', () => {
    it('transfers item + gold both sides, decrements the listing, and journals', () => {
      const v = makePlayer(1, 0);
      const b = makePlayer(2, 10_000);
      setItem(v, 5, 1, 10);                // itemId 1 (stack_size 99) -- 10 in bag
      const ctx = makeCtx([v, b]);
      // REGISTER gates on !IsVendorOpen -- configure listings, THEN open.
      assert.deepEqual(ctx.svc.registerItem(v, 0, 5, 3, 500), { ok: true });
      assert.deepEqual(ctx.svc.open(v, 'Shop'), { ok: true });
      ctx.sent.length = 0;

      assert.deepEqual(ctx.svc.buy(b, 1, 0, 1, 2), { ok: true }); // buy 2 @ 500

      assert.equal(b.m_nGold, 9_000);      // 10000 - 1000
      assert.equal(v.m_nGold, 1_000);      // 0 + 1000
      assert.equal((b.m_Inventory[0] as InventorySlot).count, 2);   // buyer got item
      assert.equal((v.m_Inventory[5] as InventorySlot).count, 8);   // vendor bag 10->8
      assert.equal(v.m_vtInfo.listings[0]!.count, 1);               // listing 3->1
      // WAL: buyer slot + both golds (vendor slot is journaled by removeItem too).
      const types = ctx.journal.map((e) => e.type).sort();
      assert.ok(types.includes('INVENTORY_SLOT'));
      assert.ok(types.includes('CHAR_GOLD'));
      // No positive ack; only gold/item snapshots + PVENDOR_ITEM_NUM.
      assert.ok(subtypes(ctx.sent).includes(SNAPSHOTTYPE.PVENDOR_ITEM_NUM));
    });

    it('aborts when the listed bag slot was emptied since listing (no dupe)', () => {
      const v = makePlayer(1, 0);
      const b = makePlayer(2, 10_000);
      setItem(v, 5, 100, 10);
      const ctx = makeCtx([v, b]);
      ctx.svc.registerItem(v, 0, 5, 3, 500);
      ctx.svc.open(v, 'Shop');
      // Simulate the vendor dropping the item after listing (slot now empty).
      v.m_Inventory[5] = null;
      assert.equal(ctx.svc.buy(b, 1, 0, 100, 1).ok, false);
      assert.equal(b.m_nGold, 10_000);     // buyer gold untouched
      assert.equal(v.m_nGold, 0);
    });

    it('aborts when the listed slot now holds a different itemId', () => {
      const v = makePlayer(1, 0);
      const b = makePlayer(2, 10_000);
      setItem(v, 5, 100, 10);
      const ctx = makeCtx([v, b]);
      ctx.svc.registerItem(v, 0, 5, 3, 500);
      ctx.svc.open(v, 'Shop');
      (v.m_Inventory[5] as InventorySlot).itemId = 999;  // swapped
      assert.equal(ctx.svc.buy(b, 1, 0, 100, 1).ok, false);
    });

    it('refuses an impoverished buyer (TID_GAME_LACKMONEY) with no mutation', () => {
      const v = makePlayer(1, 0);
      const b = makePlayer(2, 100);        // can't afford 2 @ 500
      setItem(v, 5, 100, 10);
      const ctx = makeCtx([v, b]);
      ctx.svc.registerItem(v, 0, 5, 3, 500);
      ctx.svc.open(v, 'Shop');
      assert.equal(ctx.svc.buy(b, 1, 0, 100, 2).ok, false);
      assert.equal(b.m_nGold, 100);
      assert.equal(v.m_nGold, 0);
      assert.equal(v.m_vtInfo.listings[0]!.count, 3);   // listing intact
    });

    it('refuses a buyer with a full bag (TID_GAME_LACKSPACE) with no mutation', () => {
      const v = makePlayer(1, 0);
      const b = makePlayer(2, 10_000);
      setItem(v, 5, 200, 10);              // stack_size 1 (getItemProp stub: id!==1 -> 1)
      for (let i = 0; i < 42; i++) setItem(b, i, 999, 1);  // fill the bag
      const ctx = makeCtx([v, b]);
      ctx.svc.registerItem(v, 0, 5, 1, 500);
      ctx.svc.open(v, 'Shop');
      assert.equal(ctx.svc.buy(b, 1, 0, 200, 1).ok, false);
      assert.equal(b.m_nGold, 10_000);
    });
  });

  describe('close + disconnect', () => {
    it('closeOwn clears state and broadcasts PVENDOR_CLOSE clearTitle=1', () => {
      const v = makePlayer(1);
      setItem(v, 5, 100, 1);
      const ctx = makeCtx([v]);
      ctx.svc.registerItem(v, 0, 5, 1, 10);
      ctx.svc.open(v, 'Shop');
      ctx.broadcast.length = 0;
      assert.deepEqual(ctx.svc.close(v, 1), { ok: true });
      assert.equal(v.m_vtInfo.vendorOpen, false);
      assert.equal(v.m_vtInfo.isVending, false);
      assert.equal(openFrame(ctx.broadcast[0]!.buf).subtype, SNAPSHOTTYPE.PVENDOR_CLOSE);
    });

    it('onDisconnect closes an open shop and broadcasts', () => {
      const v = makePlayer(1);
      setItem(v, 5, 100, 1);
      const ctx = makeCtx([v]);
      ctx.svc.registerItem(v, 0, 5, 1, 10);
      ctx.svc.open(v, 'Shop');
      ctx.broadcast.length = 0;
      ctx.svc.onDisconnect(v);
      assert.equal(v.m_vtInfo.vendorOpen, false);
      assert.equal(v.m_vtInfo.isVending, false);
      assert.equal(ctx.broadcast.length, 1);
    });
  });
});
