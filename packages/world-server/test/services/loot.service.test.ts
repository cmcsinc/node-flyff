/**
 * LootService test -- dest-obj arrival pickup (item + gold), range gate,
 * stale-dest cleanup, owner-lock / 7s FFA, bag-full.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LootService } from '../../src/services/loot.service';
import { NULL_ID, SNAPSHOTTYPE_CREATEITEM, SNAPSHOTTYPE_SETPOINTPARAM } from '@flyff/world-core';
import { DST_GOLD } from '../../src/net/snapshot/pointParam.serializer';
import type { CPlayer, Vec3 } from '@flyff/entities';
import type { ItemManager } from '../../src/managers/item.manager';
import type { InventoryService, AddItemResult } from '../../src/services/inventory.service';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';

/** Subtype WORD of a self-snapshot: offset 14 (after SNAPSHOT hdr + objid). */
function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

interface SetupOpts {
  itemId: number;
  count: number;
  owner: number;
  dropTime?: number;
  itemPos?: Vec3;
  addItemResult: AddItemResult;
}

function setup(opts: SetupOpts) {
  const item = {
    m_idObject: 0x80000005,
    m_dwItemId: opts.itemId,
    m_nItemNum: opts.count,
    m_idOwn: opts.owner,
    m_dwDropTime: opts.dropTime ?? Date.now(),
    m_vPos: opts.itemPos ?? { x: 100, y: 0, z: 100 },
    m_nZoneId: 1,
  };
  // `sent`/`removedIds` are reference types so their destructured bindings stay
  // live as the mocks mutate them (a boolean would be copied at return).
  const sent: Buffer[] = [];
  const removedIds: number[] = [];
  const broadcasts: Buffer[] = []; // zone MOTION broadcasts (pickup anim/sound)
  const player = {
    m_idPlayer: 42,
    m_nGold: 100,
    m_idDestObj: item.m_idObject,
    m_fArrivalRange: 0,
    m_nZoneId: 1,
    m_vPos: { x: 100, y: 0, z: 100 },
  } as unknown as CPlayer;
  const playerManager = {
    sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
  } as unknown as PlayerManager;
  const itemManager = {
    get: () => item,
    remove: (id: number) => { removedIds.push(id); return item; },
  } as unknown as ItemManager;
  const zoneManager = {
    broadcastAround: (_pos: unknown, _z: number, _r: number, buf: Buffer) => { broadcasts.push(buf); return 1; },
  } as unknown as ZoneManager;
  const inventoryService = {
    addItem: () => opts.addItemResult.ok ? { ...opts.addItemResult } : opts.addItemResult,
    addGold: (_p: CPlayer, n: number) => { player.m_nGold += n; },
  } as unknown as InventoryService;
  const loot = new LootService({ inventoryService, itemManager, playerManager, zoneManager });
  return { loot, player, item, sent, removedIds, broadcasts };
}

/** Subtype WORD of a zone-broadcast MOTION frame: offset 14. */
function motionSubtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

describe('LootService', () => {
  it('checkArrival on contact loots an item (CREATEITEM + DEL_OBJ, dest cleared)', () => {
    const { loot, player, sent, removedIds, broadcasts } = setup({
      itemId: 2950, count: 1, owner: NULL_ID,
      addItemResult: { ok: true, slot: 3, itemId: 2950, count: 1, isNew: true },
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 1, 'CREATEITEM to self');
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE_CREATEITEM);
    assert.equal(removedIds.length, 1, 'pile removed (DEL_OBJ)');
    assert.equal(player.m_idDestObj, NULL_ID, 'dest cleared');
    assert.equal(broadcasts.length, 1, 'pickup MOTION broadcast (anim/sound)');
    assert.equal(motionSubtype(broadcasts[0]!), SNAPSHOTTYPE.MOTION);
  });

  it('checkArrival loots a penya pile (SETPOINTPARAM DST_GOLD + DEL_OBJ)', () => {
    const { loot, player, sent, removedIds, broadcasts } = setup({
      itemId: 13, count: 50, owner: NULL_ID, // II_GOLD_SEED2
      addItemResult: { ok: false, reason: 'invalid' },
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE_SETPOINTPARAM);
    assert.equal(sent[0]!.readUInt32LE(16), DST_GOLD);
    assert.equal(sent[0]!.readInt32LE(20), player.m_nGold, 'value = new gold total');
    assert.equal(removedIds.length, 1);
    assert.equal(broadcasts.length, 1, 'pickup MOTION broadcast (anim/sound)');
    assert.equal(motionSubtype(broadcasts[0]!), SNAPSHOTTYPE.MOTION);
  });

  it('out of range: no loot, dest retained', () => {
    const { loot, player, sent, removedIds } = setup({
      itemId: 2950, count: 1, owner: NULL_ID,
      itemPos: { x: 100, y: 0, z: 100 },
      addItemResult: { ok: true, slot: 0, itemId: 2950, count: 1 },
    });
    player.m_vPos = { x: 200, y: 0, z: 200 }; // far away
    loot.checkArrival(player);
    assert.equal(sent.length, 0);
    assert.equal(removedIds.length, 0);
    assert.equal(player.m_idDestObj, 0x80000005, 'dest kept for a future step');
  });

  it('no dest set: no-op', () => {
    const { loot, player, sent } = setup({
      itemId: 2950, count: 1, owner: NULL_ID,
      addItemResult: { ok: true, slot: 0, itemId: 2950, count: 1 },
    });
    player.m_idDestObj = NULL_ID;
    loot.checkArrival(player);
    assert.equal(sent.length, 0);
  });

  it('non-item dest (monster/NPC, or pile gone): left untouched, no throw', () => {
    const player = {
      m_idPlayer: 42, m_nGold: 0,
      m_idDestObj: 0x40000007, m_fArrivalRange: 0, m_vPos: { x: 0, y: 0, z: 0 },
    } as unknown as CPlayer;
    const itemManager = { get: () => undefined, remove: () => undefined } as unknown as ItemManager;
    const loot = new LootService({
      itemManager,
      inventoryService: {} as unknown as InventoryService,
      playerManager: { sendTo: () => {} } as unknown as PlayerManager,
      zoneManager: { broadcastAround: () => 0 } as unknown as ZoneManager,
    });
    loot.checkArrival(player);
    // m_idDestObj is shared with monster/NPC walk-to targets -- never cleared by
    // the loot check, or melee/dialog approach would lose its dest on first move.
    assert.equal(player.m_idDestObj, 0x40000007, 'non-item dest retained');
  });

  it('owner-lock: non-owner within 7s cannot loot', () => {
    const { loot, player, sent, removedIds } = setup({
      itemId: 2950, count: 1, owner: 99, dropTime: Date.now(),
      addItemResult: { ok: true, slot: 0, itemId: 2950, count: 1 },
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 0, 'locked -- no snapshot');
    assert.equal(removedIds.length, 0, 'pile stays');
    // dest is cleared on arrival even when loot is denied -- the player did
    // arrive; a re-click re-arms it. Matches C++ clearing dest in ProcessMoveArrival.
    assert.equal(player.m_idDestObj, NULL_ID);
  });

  it('FFA after 7s: non-owner loots', () => {
    const { loot, player, sent, removedIds } = setup({
      itemId: 2950, count: 1, owner: 99, dropTime: Date.now() - 8_000,
      addItemResult: { ok: true, slot: 0, itemId: 2950, count: 1 },
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 1);
    assert.equal(removedIds.length, 1);
  });

  it('bag-full: pile left lootable, no snapshot', () => {
    const { loot, player, sent, removedIds } = setup({
      itemId: 2950, count: 1, owner: NULL_ID,
      addItemResult: { ok: false, reason: 'bag_full' },
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 0);
    assert.equal(removedIds.length, 0, 'pile stays for retry');
  });
});
