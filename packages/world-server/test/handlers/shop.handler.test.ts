/**
 * ShopHandler test -- OPENSHOPWND reads OBJID; CLOSESHOPWND is bodyless.
 *
 * OPENSHOPWND body: `DWORD objid`. Open acks with SNAPSHOTTYPE_OPENSHOPWND
 * (0x0014) carrying 4 empty vendor tabs; a rejected open sends nothing.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { ShopHandler } from '../../src/handlers/shop.handler.js';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import { MAX_VENDOR_INVENTORY, MAX_VENDOR_INVENTORY_TAB, SNAPSHOTTYPE_CREATEITEM } from '../../src/net/snapshot/constants.js';
import { DST_GOLD } from '../../src/net/snapshot/pointParam.serializer.js';
import { EMPTY_VENDOR_STOCK } from '../../src/entities/mover.js';
import type { VendorStock } from '../../src/entities/mover.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { ShopService } from '../../src/services/shop.service.js';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 7 }, write: () => true, destroy: () => {} } as never;
}

/** Snapshot subtype WORD sits at byte 14 (SNAPSHOT|NULL_ID|count|objid|word). */
function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

function makeHandler(
  openResult: { ok: true; vendorId: number; stock?: VendorStock } | { ok: false; reason: string },
) {
  const sent: Buffer[] = [];
  const player = { m_idPlayer: 0xdddd } as unknown as CPlayer;
  const playerManager = {
    get: () => player,
    sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); },
  } as unknown as PlayerManager;
  const resolved = openResult.ok
    ? { ok: true as const, vendorId: openResult.vendorId, stock: openResult.stock ?? EMPTY_VENDOR_STOCK }
    : openResult;
  const shopService = { open: () => resolved, close: () => {} } as unknown as ShopService;
  const handler = new ShopHandler({ playerManager, shopService });
  return { handler, sent };
}

describe('ShopHandler', () => {
  it('handleOpen acks OPENSHOPWND with 4 empty vendor tabs', () => {
    const w = new PacketWriter();
    w.writeDword(100); // vendor objid
    const { handler, sent } = makeHandler({ ok: true, vendorId: 100 });
    handler.handleOpen(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.OPENSHOPWND);
    // Header = SNAPSHOT(4)+NULL_ID(4)+count(2)+objid(4)+subtype(2) = 16. The
    // objid slot already carries the vendor id. Body = 4 empty vendor tabs,
    // each 8*slots+1 bytes (slots=MAX_VENDOR_INVENTORY).
    const header = 4 + 4 + 2 + 4 + 2;
    const expectedBody = MAX_VENDOR_INVENTORY_TAB * (8 * MAX_VENDOR_INVENTORY + 1);
    assert.equal(sent[0]!.length, header + expectedBody);
  });

  it('handleOpen sends nothing when the vendor is invalid', () => {
    const w = new PacketWriter();
    w.writeDword(999);
    const { handler, sent } = makeHandler({ ok: false, reason: 'invalid' });
    handler.handleOpen(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 0);
  });

  it('handleClose sends no snapshot', () => {
    const { handler, sent } = makeHandler({ ok: true, vendorId: 100 });
    handler.handleClose(mockSocket(), new PacketReader(Buffer.alloc(1)));
    assert.equal(sent.length, 0);
  });
});

// --- BUYITEM / SELLITEM ----------------------------------------------------

/** BUYITEM body: `CHAR cTab, BYTE nId, short nNum, DWORD dwItemId`. */
function writeBuy(cTab: number, nId: number, nNum: number, dwItemId: number): Buffer {
  const w = new PacketWriter();
  w.writeByte(cTab); w.writeByte(nId); w.writeWord(nNum); w.writeDword(dwItemId);
  return w.build();
}

/** SELLITEM body: `BYTE nId, short nNum`. */
function writeSell(nId: number, nNum: number): Buffer {
  const w = new PacketWriter();
  w.writeByte(nId); w.writeWord(nNum);
  return w.build();
}

/**
 * Build a handler whose shopService.buy/sell return fixed results. `sent` is the
 * captured snapshot stream; both acks are single-snapshot frames so the subtype
 * WORD lives at byte 14.
 */
function makeTradeHandler(opts: {
  buy?: unknown;
  sell?: unknown;
}): { handler: ShopHandler; sent: Buffer[] } {
  const sent: Buffer[] = [];
  const player = { m_idPlayer: 0xdddd } as unknown as CPlayer;
  const playerManager = {
    get: () => player,
    sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); },
  } as unknown as PlayerManager;
  const shopService = {
    open: () => ({ ok: true, vendorId: 100 }),
    close: () => undefined,
    buy: () => opts.buy,
    sell: () => opts.sell,
  } as unknown as ShopService;
  return { handler: new ShopHandler({ playerManager, shopService }), sent };
}

describe('ShopHandler -- BUYITEM', () => {
  it('acks a fresh-slot buy with CREATEITEM + SETPOINTPARAM(DST_GOLD)', () => {
    const { handler, sent } = makeTradeHandler({
      buy: { ok: true, slot: 3, itemId: 81, count: 5, isNew: true, gold: 950 },
    });
    handler.handleBuy(mockSocket(), new PacketReader(writeBuy(0, 0, 5, 81)));
    assert.equal(sent.length, 2);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE_CREATEITEM);
    assert.equal(subtype(sent[1]!), SNAPSHOTTYPE.SETPOINTPARAM);
    // SETPOINTPARAM: byte 16 = DST_GOLD param, byte 20 = new gold total.
    assert.equal(sent[1]!.readUInt32LE(16), DST_GOLD);
    assert.equal(sent[1]!.readUInt32LE(20), 950);
  });

  it('acks a stack-merge buy with UPDATE_ITEM instead of CREATEITEM', () => {
    const { handler, sent } = makeTradeHandler({
      buy: { ok: true, slot: 3, itemId: 81, count: 5, isNew: false, gold: 950 },
    });
    handler.handleBuy(mockSocket(), new PacketReader(writeBuy(0, 0, 5, 81)));
    assert.equal(sent.length, 2);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.UPDATE_ITEM);
  });

  it('sends nothing when the service rejects (no gold / invalid / bag_full)', () => {
    const { handler, sent } = makeTradeHandler({
      buy: { ok: false, reason: 'no_gold' },
    });
    handler.handleBuy(mockSocket(), new PacketReader(writeBuy(0, 0, 1, 81)));
    assert.equal(sent.length, 0);
  });
});

describe('ShopHandler -- SELLITEM', () => {
  it('acks a partial sell with UPDATE_ITEM(remaining) + SETPOINTPARAM', () => {
    const { handler, sent } = makeTradeHandler({
      sell: { ok: true, slot: 5, itemId: 81, remaining: 2, gold: 1004 },
    });
    handler.handleSell(mockSocket(), new PacketReader(writeSell(5, 2)));
    assert.equal(sent.length, 2);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.UPDATE_ITEM);
    assert.equal(subtype(sent[1]!), SNAPSHOTTYPE.SETPOINTPARAM);
    assert.equal(sent[1]!.readUInt32LE(20), 1004);
  });

  it('acks a full-stack sell with UPDATE_ITEM count 0 (clears slot)', () => {
    const { handler, sent } = makeTradeHandler({
      sell: { ok: true, slot: 3, itemId: 81, remaining: 0, gold: 1002 },
    });
    handler.handleSell(mockSocket(), new PacketReader(writeSell(3, 2)));
    assert.equal(sent.length, 2);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.UPDATE_ITEM);
  });

  it('sends nothing when the service rejects', () => {
    const { handler, sent } = makeTradeHandler({
      sell: { ok: false, reason: 'empty' },
    });
    handler.handleSell(mockSocket(), new PacketReader(writeSell(0, 1)));
    assert.equal(sent.length, 0);
  });
});
