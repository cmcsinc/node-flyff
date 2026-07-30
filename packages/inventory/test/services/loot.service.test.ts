/**
 * LootService test -- dest-obj arrival pickup (item + gold), range gate,
 * stale-dest cleanup, owner-lock / 7s FFA, bag-full.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { LootService } from '../../src/services/loot.service';
import { NULL_ID, SNAPSHOTTYPE_CREATEITEM, SNAPSHOTTYPE_SETPOINTPARAM, SNAPSHOTTYPE_QUERYGETPOS } from '@flyff/world-core';
import { DST_GOLD } from '@flyff/world-core';
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
      addItemResult: { ok: true, changes: [{ slot: 3, objid: 3, itemId: 2950, count: 1, isNew: true }] },
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
      addItemResult: { ok: true, changes: [{ slot: 0, objid: 0, itemId: 2950, count: 1, isNew: true }] },
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
      addItemResult: { ok: true, changes: [{ slot: 0, objid: 0, itemId: 2950, count: 1, isNew: true }] },
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
      addItemResult: { ok: true, changes: [{ slot: 0, objid: 0, itemId: 2950, count: 1, isNew: true }] },
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
      addItemResult: { ok: true, changes: [{ slot: 0, objid: 0, itemId: 2950, count: 1, isNew: true }] },
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 1);
    assert.equal(removedIds.length, 1);
  });

  it('sameParty seam: party member loots owner-locked pile pre-FFA', () => {
    // Player 42, drop owned by 99. Without sameParty this is owner-locked until
    // the 7s FFA timeout (see the owner-lock test above). Inject a sameParty
    // closure that says 42 + 99 are partymates -> loot succeeds immediately.
    const item = {
      m_idObject: 0x80000005, m_dwItemId: 2950, m_nItemNum: 1, m_idOwn: 99,
      m_dwDropTime: Date.now(), m_vPos: { x: 100, y: 0, z: 100 }, m_nZoneId: 1,
    };
    const sent: Buffer[] = [];
    const removedIds: number[] = [];
    const player = {
      m_idPlayer: 42, m_nGold: 100, m_idDestObj: item.m_idObject, m_fArrivalRange: 0,
      m_nZoneId: 1, m_vPos: { x: 100, y: 0, z: 100 },
    } as unknown as CPlayer;
    const loot = new LootService({
      inventoryService: { addItem: () => ({ ok: true, changes: [{ slot: 0, objid: 1, itemId: 2950, count: 1, isNew: true }] }) } as unknown as InventoryService,
      itemManager: { get: () => item, remove: (id: number) => { removedIds.push(id); return item; } } as unknown as ItemManager,
      playerManager: { sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); } } as unknown as PlayerManager,
      zoneManager: { broadcastAround: () => 1 } as unknown as ZoneManager,
      sameParty: (a, b) => a === 42 && b === 99,
    });
    loot.checkArrival(player);
    assert.equal(sent.length, 1, 'party member loots pre-FFA');
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

  it('onAcquireItem fires after a successful item pickup (not gold, not bag-full)', () => {
    // Item pickup -> CREATEITEM + onAcquireItem(itemId, count).
    const calls: Array<[number, number]> = [];
    const item = {
      m_idObject: 0x80000009, m_dwItemId: 2950, m_nItemNum: 3, m_idOwn: NULL_ID,
      m_dwDropTime: Date.now(), m_vPos: { x: 100, y: 0, z: 100 }, m_nZoneId: 1,
    };
    const player = {
      m_idPlayer: 7, m_nGold: 0, m_idDestObj: item.m_idObject, m_fArrivalRange: 0,
      m_nZoneId: 1, m_vPos: { x: 100, y: 0, z: 100 },
    } as unknown as CPlayer;
    const loot = new LootService({
      inventoryService: { addItem: () => ({ ok: true, changes: [{ slot: 0, objid: 1, itemId: 2950, count: 3, isNew: true }] }) } as unknown as InventoryService,
      itemManager: { get: () => item, remove: () => item } as unknown as ItemManager,
      playerManager: { sendTo: () => {} } as unknown as PlayerManager,
      zoneManager: { broadcastAround: () => 1 } as unknown as ZoneManager,
      onAcquireItem: (_p, itemId, count) => { calls.push([itemId, count]); },
    });
    loot.checkArrival(player);
    assert.deepEqual(calls, [[2950, 3]]);

    // Gold pickup -> SETPOINTPARAM only, onAcquireItem NOT fired.
    calls.length = 0;
    const gold = { ...item, m_dwItemId: 13, m_nItemNum: 50 };
    const p2 = { ...player, m_idDestObj: gold.m_idObject } as unknown as CPlayer;
    const lootGold = new LootService({
      inventoryService: { addItem: () => ({ ok: false, reason: 'invalid' }), addGold: () => {} } as unknown as InventoryService,
      itemManager: { get: () => gold, remove: () => gold } as unknown as ItemManager,
      playerManager: { sendTo: () => {} } as unknown as PlayerManager,
      zoneManager: { broadcastAround: () => 1 } as unknown as ZoneManager,
      onAcquireItem: (_p, itemId, count) => { calls.push([itemId, count]); },
    });
    lootGold.checkArrival(p2);
    assert.equal(calls.length, 0, 'gold path does not fire onAcquireItem');
  });
});

/**
 * Walk-poll: the fix for "pickup not proceeding". While the client auto-walks to
 * a dest object it sends NO movement packet, so the ONLY arrival check that ever
 * ran was the immediate one at PLAYERSETDESTOBJ time. `onSetDestObj` now arms a
 * QUERYGETPOS poll; each reply arrives as GETPOS -> `checkArrival`.
 */
describe('LootService walk-to-pile poll', () => {
  // mock.timers.enable() is session-global -- reset per test (memory
  // `node-test-mock-timers-gotcha`).
  beforeEach(() => { mock.timers.enable({ apis: ['setInterval', 'Date'] }); });
  afterEach(() => { mock.timers.reset(); });

  interface PollHarness {
    loot: LootService;
    player: CPlayer;
    sent: Buffer[];
    /** Mutable so a test can make the pile vanish mid-walk. */
    pile: { value: unknown };
  }

  function pollSetup(itemPos = { x: 200, y: 0, z: 200 }): PollHarness {
    const item = {
      m_idObject: 0x80000011, m_dwItemId: 2950, m_nItemNum: 1, m_idOwn: NULL_ID,
      m_dwDropTime: Date.now(), m_vPos: itemPos, m_nZoneId: 1,
    };
    const pile: { value: unknown } = { value: item };
    const sent: Buffer[] = [];
    const player = {
      m_idPlayer: 42, m_nGold: 0, m_idDestObj: item.m_idObject, m_fArrivalRange: 0,
      m_nZoneId: 1, m_vPos: { x: 100, y: 0, z: 100 }, // far from the pile
    } as unknown as CPlayer;
    const loot = new LootService({
      inventoryService: {
        addItem: () => ({ ok: true, changes: [{ slot: 0, objid: 1, itemId: 2950, count: 1, isNew: true }] }),
      } as unknown as InventoryService,
      itemManager: {
        get: () => pile.value, remove: () => pile.value,
      } as unknown as ItemManager,
      playerManager: {
        get: () => player,
        sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); },
      } as unknown as PlayerManager,
      zoneManager: { broadcastAround: () => 1 } as unknown as ZoneManager,
    });
    return { loot, player, sent, pile };
  }

  it('arms a QUERYGETPOS poll when the pile is out of reach', () => {
    const { loot, player, sent } = pollSetup();
    loot.onSetDestObj(player);
    assert.equal(sent.length, 0, 'no immediate loot -- out of range');

    mock.timers.tick(300);
    assert.equal(sent.length, 1, 'one QUERYGETPOS after the first interval');
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE_QUERYGETPOS);
    // idFrom must be NULL_ID or OnGetPos will not take the position as the
    // sender's own (DPSrvr.cpp:1463).
    assert.equal(sent[0]!.readUInt32LE(16), NULL_ID, 'idFrom = NULL_ID');

    mock.timers.tick(500);
    assert.equal(sent.length, 3, 'keeps polling while walking');
  });

  it('stops polling once the player arrives and the pile is looted', () => {
    const { loot, player, sent } = pollSetup();
    loot.onSetDestObj(player);
    mock.timers.tick(300);
    assert.equal(sent.length, 1);

    // The client walked onto the pile and its GETPOS reply landed -> arrival.
    player.m_vPos = { x: 200, y: 0, z: 200 };
    loot.checkArrival(player);
    assert.equal(player.m_idDestObj, NULL_ID, 'looted, dest cleared');

    const afterLoot = sent.length;
    mock.timers.tick(2_000);
    assert.equal(sent.length, afterLoot, 'no further QUERYGETPOS after pickup');
  });

  it('stops polling when the pile decays mid-walk', () => {
    const { loot, player, sent, pile } = pollSetup();
    loot.onSetDestObj(player);
    mock.timers.tick(300);
    const before = sent.length;

    pile.value = undefined; // 3-min decay fired
    mock.timers.tick(1_000);
    assert.equal(sent.length, before, 'poll cancelled with the pile gone');
  });

  it('gives up after the walk timeout', () => {
    const { loot, player, sent } = pollSetup();
    loot.onSetDestObj(player);
    mock.timers.tick(16_000);
    const atTimeout = sent.length;
    mock.timers.tick(5_000);
    assert.equal(sent.length, atTimeout, 'poll stopped at the deadline');
  });

  it('does not poll for a non-item dest (monster/NPC walk-to)', () => {
    const { loot, player, sent, pile } = pollSetup();
    pile.value = undefined;              // itemManager.get -> undefined
    player.m_idDestObj = 0x40000007;     // a mover objid
    loot.onSetDestObj(player);
    mock.timers.tick(2_000);
    assert.equal(sent.length, 0, 'melee/dialog approach must not arm a loot poll');
  });

  it('shutdown clears an armed poll', () => {
    const { loot, player, sent } = pollSetup();
    loot.onSetDestObj(player);
    mock.timers.tick(300);
    const before = sent.length;
    loot.shutdown();
    mock.timers.tick(2_000);
    assert.equal(sent.length, before, 'no timers left running');
  });
});
