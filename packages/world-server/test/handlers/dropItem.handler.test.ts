/**
 * DropItemHandler test -- DROPITEM (0x00ff0007).
 *
 * Body: `DWORD dwItemType, DWORD dwItemId(=slot), short nDropNum, D3DXVECTOR3`.
 * On a successful drop the service returns the item/count and the handler
 * spawns a ground pile. A rejected drop (ok:false) spawns nothing.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { DropItemHandler } from '../../src/handlers/dropItem.handler.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { ItemManager } from '../../src/managers/item.manager.js';
import type { InventoryService } from '../../src/services/inventory.service.js';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function body(slot: number, count: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(0);            // dwItemType -- unused
  w.writeDword(slot);         // dwItemId = inv slot objid
  w.writeWord(count);         // nDropNum
  w.writeFloat(1); w.writeFloat(2); w.writeFloat(3);
  return w.build();
}

describe('DropItemHandler', () => {
  it('spawns a ground pile on a successful drop', () => {
    const spawned: Array<{ itemId: number; count: number; ownerId: number }> = [];
    const player = { m_idPlayer: 42, m_nZoneId: 1 } as unknown as CPlayer;
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const itemManager = { spawn: (init: { itemId: number; count: number; ownerId: number }) => { spawned.push(init); return 1; } } as unknown as ItemManager;
    const inventoryService = {
      dropItem: () => ({ ok: true, itemId: 2950, count: 3, pos: { x: 1, y: 2, z: 3 } }),
    } as unknown as InventoryService;
    const handler = new DropItemHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropItem(mockSocket(), new PacketReader(body(5, 3)));

    assert.deepEqual(spawned[0], { itemId: 2950, count: 3, ownerId: 42, pos: { x: 1, y: 2, z: 3 }, zoneId: 1 });
  });

  it('spawns nothing when the service rejects', () => {
    let spawned = 0;
    const player = { m_idPlayer: 42, m_nZoneId: 1 } as unknown as CPlayer;
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const itemManager = { spawn: () => { spawned++; return 1; } } as unknown as ItemManager;
    const inventoryService = {
      dropItem: () => ({ ok: false, reason: 'invalid' as const }),
    } as unknown as InventoryService;
    const handler = new DropItemHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropItem(mockSocket(), new PacketReader(body(5, 3)));

    assert.equal(spawned, 0);
  });
});
