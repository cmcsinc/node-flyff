/**
 * MoveItemHandler test -- MOVEITEM (0x00ff0006) slot swap.
 *
 * Body: `BYTE nItemType, BYTE nSrc, BYTE nDst`. The handler validates both slots
 * against MAX_INVENTORY, delegates to InventoryService.moveItem, and on success
 * echoes `SNAPSHOTTYPE_MOVEITEM` (0x0004) -- the client does not swap
 * optimistically; the echo is what triggers `m_Inventory.Swap` (`DPClient.cpp:2141`).
 * A rejected move sends no echo.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MoveItemHandler } from '../../src/handlers/moveItem.handler';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { InventoryService } from '../../src/services/inventory.service';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function body(nSrc: number, nDst: number): Buffer {
  const w = new PacketWriter();
  w.writeByte(0);       // nItemType -- unused
  w.writeByte(nSrc);
  w.writeByte(nDst);
  return w.build();
}

describe('MoveItemHandler', () => {
  it('delegates a valid swap to inventoryService.moveItem and echoes MOVEITEM', () => {
    const calls: Array<{ src: number; dst: number }> = [];
    const sent: Buffer[] = [];
    const player = { m_idPlayer: 42 } as unknown as CPlayer;
    const playerManager = {
      get: () => player,
      sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
    } as unknown as PlayerManager;
    const inventoryService = {
      moveItem: (_p: CPlayer, src: number, dst: number) => { calls.push({ src, dst }); return { ok: true, src, dst }; },
    } as unknown as InventoryService;
    const handler = new MoveItemHandler({ playerManager, inventoryService });

    handler.handleMoveItem(mockSocket(), new PacketReader(body(1, 2)));

    assert.deepEqual(calls[0], { src: 1, dst: 2 });
    assert.equal(sent.length, 1, 'echoed SNAPSHOTTYPE_MOVEITEM on success');
    // Snapshot frames PACKETTYPE.SNAPSHOT|NULL_ID|count=1|objid|subtype|body; the
    // trailing 3 payload bytes are nItemType(0), nSrc, nDst.
    const tail = sent[0]!.subarray(-3);
    assert.deepEqual(Array.from(tail), [0, 1, 2]);
  });

  it('rejects an out-of-range slot without calling moveItem or echoing', () => {
    let called = false;
    const sent: Buffer[] = [];
    const player = { m_idPlayer: 42 } as unknown as CPlayer;
    const playerManager = {
      get: () => player,
      sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
    } as unknown as PlayerManager;
    const inventoryService = { moveItem: () => { called = true; return { ok: false, reason: 'invalid' as const }; } } as unknown as InventoryService;
    const handler = new MoveItemHandler({ playerManager, inventoryService });

    handler.handleMoveItem(mockSocket(), new PacketReader(body(50, 0)));

    assert.equal(called, false, 'Validate.slot rejects before the service is called');
    assert.equal(sent.length, 0, 'no echo on rejected move');
  });
});
