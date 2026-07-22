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
import { MAX_VENDOR_INVENTORY, MAX_VENDOR_INVENTORY_TAB } from '../../src/net/snapshot/constants.js';
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
