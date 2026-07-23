/**
 * DropGoldHandler test -- DROPGOLD (0x00ff0008).
 *
 * Body: `DWORD dwGold, D3DXVECTOR3`. On success spawns a gold pile whose itemId
 * is picked by `goldSeedId(amount)`. Over-spend is rejected by the service and
 * spawns nothing.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { DropGoldHandler } from '../../src/handlers/dropGold.handler';
import { goldSeedId } from '../../src/services/drop.service';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ItemManager } from '../../src/managers/item.manager';
import type { InventoryService } from '../../src/services/inventory.service';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function body(amount: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(amount);
  w.writeFloat(10); w.writeFloat(20); w.writeFloat(30);
  return w.build();
}

describe('DropGoldHandler', () => {
  it('spawns a gold pile sized by goldSeedId(amount)', () => {
    let spawned: { itemId: number; count: number } | null = null;
    const player = { m_idPlayer: 42, m_nZoneId: 1 } as unknown as CPlayer;
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const itemManager = { spawn: (init: { itemId: number; count: number }) => { spawned = init; return 1; } } as unknown as ItemManager;
    const inventoryService = {
      dropGold: () => ({ ok: true, amount: 500, pos: { x: 10, y: 20, z: 30 } }),
    } as unknown as InventoryService;
    const handler = new DropGoldHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropGold(mockSocket(), new PacketReader(body(500)));

    assert.ok(spawned);
    assert.equal(spawned!.itemId, goldSeedId(500), 'itemId chosen by amount tier');
    assert.equal(spawned!.count, 500);
  });

  it('spawns nothing when over-spend is rejected', () => {
    let spawned = 0;
    const player = { m_idPlayer: 42, m_nZoneId: 1 } as unknown as CPlayer;
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const itemManager = { spawn: () => { spawned++; return 1; } } as unknown as ItemManager;
    const inventoryService = {
      dropGold: () => ({ ok: false, reason: 'invalid' as const }),
    } as unknown as InventoryService;
    const handler = new DropGoldHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropGold(mockSocket(), new PacketReader(body(99999)));

    assert.equal(spawned, 0);
  });
});
