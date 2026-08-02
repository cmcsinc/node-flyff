/**
 * DoUseItemHandler test -- DOUSEITEM (0x00ff0021).
 *
 * Body: `DWORD dwData, OBJID objid, int nPart[, FLOAT fVal]`. The slot is
 * HIWORD(dwData). Routes via UseItemService: equip -> DOEQUIP snapshots;
 * consumable -> SETPOINTPARAM(DST_HP/MP/FP) per restored pool.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { DoUseItemHandler } from '../../src/handlers/doUseItem.handler';
import { DST_HP, DST_MP, DST_FP } from '@flyff/world-core';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { UseItemService, UseResult } from '../../src/services/useItem.service';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function body(slot: number, nPart: number): Buffer {
  const w = new PacketWriter();
  w.writeDword((slot << 16) >>> 0); // dwData = HIWORD(slot)
  w.writeDword(0);                  // objid -- focus target, unused
  w.writeDword(nPart);
  return w.build();
}

function makeHandler(
  result: UseResult,
  opts: { getItem?: (id: number) => { equip_slot?: number; flight_speed?: number } | undefined } = {},
) {
  const sent: Buffer[] = [];
  const broadcasts: Buffer[] = [];
  const player = {
    m_idPlayer: 0xbbbb, m_vPos: { x: 0, y: 0, z: 0 }, m_nZoneId: 1, m_bDead: false,
    m_Inventory: new Array(73).fill(null),
    findSlotByObjId: () => 0,
  } as unknown as CPlayer;
  const playerManager = { get: () => player, sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); } } as unknown as PlayerManager;
  const zoneManager = { broadcastAround: (_pos: unknown, _z: unknown, _r: unknown, b: Buffer) => { broadcasts.push(b); } } as unknown as ZoneManager;
  const useItemService = { use: () => result } as unknown as UseItemService;
  const handler = new DoUseItemHandler({
    playerManager, zoneManager, useItemService,
    getItem: opts.getItem ?? (() => undefined),
  });
  return { handler, sent, broadcasts };
}

describe('DoUseItemHandler', () => {
  it('consumable: sends SETPOINTPARAM per restored pool + UPDATE_ITEM for the count', () => {
    const { handler, sent } = makeHandler({ kind: 'consumable', nId: 2, remaining: 4, hp: 150, mp: 90, fp: 40 });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(2, 0)));
    // 3 SETPOINTPARAM (HP/MP/FP) + 1 UPDATE_ITEM
    const byType = sent.map((b) => b.readUInt16LE(14));
    const pointParams = sent.filter((b) => b.readUInt16LE(14) === SNAPSHOTTYPE.SETPOINTPARAM);
    const params = pointParams.map((b) => b.readUInt32LE(16)).sort((a, b) => a - b);
    assert.deepEqual(params, [DST_HP, DST_MP, DST_FP].sort((a, b) => a - b));
    assert.equal(pointParams[0]!.readUInt32LE(20), 150, 'value = new HP total');
    assert.ok(byType.includes(SNAPSHOTTYPE.UPDATE_ITEM), 'UPDATE_ITEM sent for stack decrement');
    const upd = sent.find((b) => b.readUInt16LE(14) === SNAPSHOTTYPE.UPDATE_ITEM)!;
    assert.equal(upd.readUInt8(17), 2, 'UPDATE_ITEM nId = slot');
    assert.equal(upd.readUInt32LE(19), 4, 'UPDATE_ITEM dwValue = remaining count');
  });

  it('consumable: UPDATE_ITEM is sent even with no restored pools (count must drop)', () => {
    const { handler, sent } = makeHandler({ kind: 'consumable', nId: 0, remaining: 2, hp: 180 });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(0, 0)));
    // 1 SETPOINTPARAM (HP) + 1 UPDATE_ITEM
    assert.equal(sent.filter((b) => b.readUInt16LE(14) === SNAPSHOTTYPE.SETPOINTPARAM).length, 1);
    const upd = sent.find((b) => b.readUInt16LE(14) === SNAPSHOTTYPE.UPDATE_ITEM)!;
    assert.equal(upd.readUInt32LE(19), 2, 'remaining count');
  });

  it('consumable: remaining=0 still sends UPDATE_ITEM (client removes slot)', () => {
    const { handler, sent } = makeHandler({ kind: 'consumable', nId: 3, remaining: 0 });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(3, 0)));
    const upd = sent.find((b) => b.readUInt16LE(14) === SNAPSHOTTYPE.UPDATE_ITEM)!;
    assert.equal(upd.readUInt32LE(19), 0, 'count 0 => client clears slot');
  });

  it('consumed (buff/skill/...): sends UPDATE_ITEM only', () => {
    const { handler, sent } = makeHandler({ kind: 'consumed', nId: 1, remaining: 0 });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(1, 0)));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.readUInt16LE(14), SNAPSHOTTYPE.UPDATE_ITEM);
  });

  it('equip: one vicinity DOEQUIP broadcast to self + peers', () => {
    const { handler, sent, broadcasts } = makeHandler({
      kind: 'equip',
      equip: { ok: true, parts: 9, itemId: 5000, invSlot: 4, objid: 4 },
    });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(4, 9)));
    assert.equal(sent.length, 0, 'no separate self packet -- self rides the broadcast');
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0]!.readUInt16LE(14), SNAPSHOTTYPE.DOEQUIP);
    assert.equal(broadcasts[0]![16], 4, 'wire nId = bag slot');
    assert.equal(broadcasts[0]![21], 1, 'fEquip = 1');
  });

  it('reject: sends nothing', () => {
    const { handler, sent } = makeHandler({ kind: 'reject' });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(0, 0)));
    assert.equal(sent.length, 0);
  });
});
