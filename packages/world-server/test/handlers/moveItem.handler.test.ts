/**
 * MoveItemHandler test — MOVEITEM (0x00ff0006) slot swap.
 *
 * Body: `BYTE nItemType, BYTE nSrc, BYTE nDst`. The handler validates both slots
 * against MAX_INVENTORY and delegates to InventoryService.moveItem. No reply —
 * the client moves optimistically; JOIN reflects the new order on relog.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { MoveItemHandler } from '../../src/handlers/moveItem.handler.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { InventoryService } from '../../src/services/inventory.service.js';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function body(nSrc: number, nDst: number): Buffer {
  const w = new PacketWriter();
  w.writeByte(0);       // nItemType — unused
  w.writeByte(nSrc);
  w.writeByte(nDst);
  return w.build();
}

describe('MoveItemHandler', () => {
  it('delegates a valid swap to inventoryService.moveItem', () => {
    const calls: Array<{ src: number; dst: number }> = [];
    const player = { m_idPlayer: 42 } as unknown as CPlayer;
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const inventoryService = {
      moveItem: (_p: CPlayer, src: number, dst: number) => { calls.push({ src, dst }); return { ok: true, src, dst }; },
    } as unknown as InventoryService;
    const handler = new MoveItemHandler({ playerManager, inventoryService });

    handler.handleMoveItem(mockSocket(), new PacketReader(body(1, 2)));

    assert.deepEqual(calls[0], { src: 1, dst: 2 });
  });

  it('rejects an out-of-range slot without calling moveItem', () => {
    let called = false;
    const player = { m_idPlayer: 42 } as unknown as CPlayer;
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const inventoryService = { moveItem: () => { called = true; return { ok: false, reason: 'invalid' as const }; } } as unknown as InventoryService;
    const handler = new MoveItemHandler({ playerManager, inventoryService });

    handler.handleMoveItem(mockSocket(), new PacketReader(body(50, 0)));

    assert.equal(called, false, 'Validate.slot rejects before the service is called');
  });
});
