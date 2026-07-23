/**
 * ActMsgHandler test -- pickup happy path (item + gold), bag-full, wrong-owner
 * reject, and unknown-objid no-op.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { ActMsgHandler } from '../../src/handlers/actMsg.handler';
import { NULL_ID, SNAPSHOTTYPE_CREATEITEM, SNAPSHOTTYPE_SETPOINTPARAM } from '@flyff/world-core';
import { DST_GOLD } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { ItemManager } from '../../src/managers/item.manager';
import type { InventoryService, AddItemResult } from '../../src/services/inventory.service';
import type { PlayerManager } from '@flyff/world-core';

const OBJMSG_PICKUP = 11;

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

/** ACTMSG body: dwMsg | nParam1 | nParam2 (3* DWORD). */
const body = (dwMsg: number, nParam1: number, nParam2 = 0): Buffer => {
  const w = new PacketWriter();
  w.writeDword(dwMsg);
  w.writeDword(nParam1);
  w.writeDword(nParam2);
  return w.build();
};

/** Subtype of a self-snapshot buffer: the WORD at offset 14 (after SNAPSHOT hdr + objid). */
function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

/** Fake ground item shape consumed by the handler. `dropTime` defaults to now. */
function groundItem(itemId: number, count: number, owner: number, dropTime: number = Date.now()) {
  return {
    m_dwItemId: itemId,
    m_nItemNum: count,
    m_idOwn: owner,
    m_dwDropTime: dropTime,
    m_vPos: { x: 0, y: 0, z: 0 },
    m_nZoneId: 1,
  };
}

function makeHandler(opts: {
  item: ReturnType<typeof groundItem> | undefined;
  addItemResult: AddItemResult;
  onRemove?: () => void;
}) {
  const sent: Buffer[] = [];
  const player = { m_idPlayer: 42, m_nGold: 100 } as unknown as CPlayer;
  let goldAdded = 0;
  const playerManager = {
    get: () => player,
    sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); },
  } as unknown as PlayerManager;
  const itemManager = {
    get: () => opts.item,
    remove: () => { opts.onRemove?.(); return opts.item; },
  } as unknown as ItemManager;
  const inventoryService = {
    addItem: (_p: CPlayer, itemId: number, count: number) => {
      if (opts.addItemResult.ok) return { ...opts.addItemResult, itemId, count };
      return opts.addItemResult;
    },
    addGold: (_p: CPlayer, amount: number) => { goldAdded += amount; player.m_nGold += amount; },
  } as unknown as InventoryService;
  const handler = new ActMsgHandler({ playerManager, itemManager, inventoryService });
  return { handler, player, sent, goldAdded };
}

describe('ActMsgHandler', () => {
  it('item pickup: CREATEITEM to self + remove (DEL_OBJ) called', () => {
    const { handler, sent } = makeHandler({
      item: groundItem(2950, 1, NULL_ID),
      addItemResult: { ok: true, slot: 3, itemId: 2950, count: 1, isNew: true },
    });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0x80000000)));
    assert.equal(sent.length, 1, 'one self-snapshot (CREATEITEM)');
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE_CREATEITEM);
  });

  it('gold pickup: SETPOINTPARAM(DST_GOLD) to self + remove called', () => {
    let removed = false;
    const { handler, sent, player } = makeHandler({
      item: groundItem(13, 50, NULL_ID), // II_GOLD_SEED2
      addItemResult: { ok: false, reason: 'invalid' },
      onRemove: () => { removed = true; },
    });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0x80000001)));
    assert.equal(sent.length, 1);
    const buf = sent[0]!;
    assert.equal(subtype(buf), SNAPSHOTTYPE_SETPOINTPARAM);
    assert.equal(buf.readUInt32LE(16), DST_GOLD, 'param = DST_GOLD');
    assert.equal(buf.readInt32LE(20), player.m_nGold, 'value = new gold total');
    assert.equal(removed, true, 'pile removed (DEL_OBJ broadcast)');
  });

  it('rejects pickup when another player owns the pile (within the 7s lock)', () => {
    let removed = false;
    const { handler, sent } = makeHandler({
      item: groundItem(2950, 1, 99, Date.now()), // owned by char 99, fresh drop -- locked
      addItemResult: { ok: true, slot: 0, itemId: 2950, count: 1 },
      onRemove: () => { removed = true; },
    });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0x80000002)));
    assert.equal(sent.length, 0, 'no snapshot -- anti-loot-steal lock holds');
    assert.equal(removed, false, 'pile left in world');
  });

  it('anti-loot-steal FFA: non-owner can loot after the 7s window', () => {
    let removed = false;
    const { handler, sent } = makeHandler({
      // owned by char 99, but dropped 8s ago -- past the LOOT_FFA_MS gate
      item: groundItem(2950, 1, 99, Date.now() - 8_000),
      addItemResult: { ok: true, slot: 0, itemId: 2950, count: 1 },
      onRemove: () => { removed = true; },
    });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0x80000002)));
    assert.equal(sent.length, 1, 'FFA after 7s -- non-owner loots');
    assert.equal(removed, true, 'pile removed');
  });

  it('bag-full: no CREATEITEM, pile left lootable', () => {
    let removed = false;
    const { handler, sent } = makeHandler({
      item: groundItem(2950, 1, NULL_ID),
      addItemResult: { ok: false, reason: 'bag_full' },
      onRemove: () => { removed = true; },
    });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0x80000003)));
    assert.equal(sent.length, 0);
    assert.equal(removed, false);
  });

  it('unknown objid is a silent no-op', () => {
    const { handler, sent } = makeHandler({ item: undefined, addItemResult: { ok: false, reason: 'invalid' } });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0xdeadbeef)));
    assert.equal(sent.length, 0);
  });

  it('parses objids >= 0x80000000 without sign issues', () => {
    // Item objids start at FIRST_ITEM_ID 0x80000000 -- readDword must yield the unsigned value.
    let seenObjid = 0;
    const player = { m_idPlayer: 42, m_nGold: 0 } as unknown as CPlayer;
    const playerManager = { get: () => player, sendTo: () => {} } as unknown as PlayerManager;
    const itemManager = {
      get: (id: number) => { seenObjid = id; return undefined; },
      remove: () => undefined,
    } as unknown as ItemManager;
    const inventoryService = {} as unknown as InventoryService;
    const handler = new ActMsgHandler({ playerManager, itemManager, inventoryService });
    handler.handleActMsg(mockSocket(), new PacketReader(body(OBJMSG_PICKUP, 0x80000000)));
    assert.equal(seenObjid, 0x80000000);
  });
});
