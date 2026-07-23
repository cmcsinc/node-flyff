/**
 * DropItemHandler test -- DROPITEM (0x00ff0007).
 *
 * Body: `DWORD dwItemType, DWORD dwItemId(=m_dwObjId), short nDropNum, D3DXVECTOR3`.
 * The handler resolves dwItemId -> slot via CPlayer.findSlotByObjId (the wire id
 * is the elem's STABLE objid, not its current slot), delegates to the service,
 * spawns a ground pile, AND echoes UPDATE_ITEM with the post-drop count so the
 * client clears the slot (omitting the echo = item dupe). A rejected drop spawns
 * nothing and sends no echo.
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

function body(objid: number, count: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(0);            // dwItemType -- unused
  w.writeDword(objid);        // dwItemId = inv elem m_dwObjId
  w.writeWord(count);         // nDropNum
  w.writeFloat(1); w.writeFloat(2); w.writeFloat(3);
  return w.build();
}

describe('DropItemHandler', () => {
  it('spawns a ground pile and echoes UPDATE_ITEM on a successful drop', () => {
    const spawned: Array<{ itemId: number; count: number; ownerId: number }> = [];
    const sent: Buffer[] = [];
    const player = {
      m_idPlayer: 42, m_nZoneId: 1, findSlotByObjId: (id: number) => (id === 9001 ? 5 : -1),
    } as unknown as CPlayer;
    const playerManager = {
      get: () => player,
      sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
    } as unknown as PlayerManager;
    const itemManager = { spawn: (init: { itemId: number; count: number; ownerId: number }) => { spawned.push(init); return 1; } } as unknown as ItemManager;
    const inventoryService = {
      dropItem: () => ({ ok: true, slot: 5, itemId: 2950, count: 3, remaining: 0, pos: { x: 1, y: 2, z: 3 } }),
    } as unknown as InventoryService;
    const handler = new DropItemHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropItem(mockSocket(), new PacketReader(body(9001, 3)));

    assert.deepEqual(spawned[0], { itemId: 2950, count: 3, ownerId: 42, pos: { x: 1, y: 2, z: 3 }, zoneId: 1 });
    assert.equal(sent.length, 1, 'UPDATE_ITEM clear echo must be sent so the client drops the slot');
  });

  it('spawns nothing and sends no echo when the service rejects', () => {
    let spawned = 0;
    const sent: Buffer[] = [];
    const player = {
      m_idPlayer: 42, m_nZoneId: 1, findSlotByObjId: () => 5,
    } as unknown as CPlayer;
    const playerManager = {
      get: () => player,
      sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
    } as unknown as PlayerManager;
    const itemManager = { spawn: () => { spawned++; return 1; } } as unknown as ItemManager;
    const inventoryService = {
      dropItem: () => ({ ok: false, reason: 'invalid' as const }),
    } as unknown as InventoryService;
    const handler = new DropItemHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropItem(mockSocket(), new PacketReader(body(9001, 3)));

    assert.equal(spawned, 0);
    assert.equal(sent.length, 0);
  });

  it('rejects when the objid does not resolve to a slot (moved / unknown item)', () => {
    let spawned = 0;
    const sent: Buffer[] = [];
    const player = {
      m_idPlayer: 42, m_nZoneId: 1, findSlotByObjId: () => -1,
    } as unknown as CPlayer;
    const playerManager = {
      get: () => player,
      sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
    } as unknown as PlayerManager;
    const itemManager = { spawn: () => { spawned++; return 1; } } as unknown as ItemManager;
    const inventoryService = { dropItem: () => ({ ok: false, reason: 'invalid' as const }) } as unknown as InventoryService;
    const handler = new DropItemHandler({ playerManager, itemManager, inventoryService });

    handler.handleDropItem(mockSocket(), new PacketReader(body(9001, 3)));

    assert.equal(spawned, 0);
    assert.equal(sent.length, 0);
  });
});
