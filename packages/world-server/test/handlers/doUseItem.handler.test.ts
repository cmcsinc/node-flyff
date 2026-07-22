/**
 * DoUseItemHandler test -- DOUSEITEM (0x00ff0021).
 *
 * Body: `DWORD dwData, OBJID objid, int nPart[, FLOAT fVal]`. The slot is
 * HIWORD(dwData). Routes via UseItemService: equip -> DOEQUIP snapshots;
 * consumable -> SETPOINTPARAM(DST_HP/MP/FP) per restored pool.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { DoUseItemHandler } from '../../src/handlers/doUseItem.handler.js';
import { DST_HP, DST_MP, DST_FP } from '../../src/net/snapshot/pointParam.serializer.js';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { ZoneManager } from '../../src/managers/zone.manager.js';
import type { UseItemService, UseResult } from '../../src/services/useItem.service.js';

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

function makeHandler(result: UseResult) {
  const sent: Buffer[] = [];
  const broadcasts: Buffer[] = [];
  const player = { m_idPlayer: 0xbbbb, m_vPos: { x: 0, y: 0, z: 0 }, m_nZoneId: 1, m_bDead: false } as unknown as CPlayer;
  const playerManager = { get: () => player, sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); } } as unknown as PlayerManager;
  const zoneManager = { broadcastAround: (_pos: unknown, _z: unknown, _r: unknown, b: Buffer) => { broadcasts.push(b); } } as unknown as ZoneManager;
  const useItemService = { use: () => result } as unknown as UseItemService;
  const handler = new DoUseItemHandler({ playerManager, zoneManager, useItemService });
  return { handler, sent, broadcasts };
}

describe('DoUseItemHandler', () => {
  it('consumable: sends SETPOINTPARAM for each restored pool (HP/MP/FP)', () => {
    const { handler, sent } = makeHandler({ kind: 'consumable', nId: 2, hp: 150, mp: 90, fp: 40 });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(2, 0)));
    assert.equal(sent.length, 3, 'one SETPOINTPARAM per pool');
    const params = sent.map((b) => b.readUInt32LE(16)).sort((a, b) => a - b);
    assert.deepEqual(params, [DST_HP, DST_MP, DST_FP].sort((a, b) => a - b));
    assert.equal(sent[0]!.readUInt16LE(14), SNAPSHOTTYPE.SETPOINTPARAM);
    assert.equal(sent[0]!.readUInt32LE(20), 150, 'value = new HP total');
  });

  it('consumable: omits pools that were not restored', () => {
    const { handler, sent } = makeHandler({ kind: 'consumable', nId: 0, hp: 180 });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(0, 0)));
    assert.equal(sent.length, 1, 'only HP sent');
    assert.equal(sent[0]!.readUInt32LE(16), DST_HP);
  });

  it('equip: sends self DOEQUIP + vicinity broadcast', () => {
    const { handler, sent, broadcasts } = makeHandler({
      kind: 'equip',
      equip: { ok: true, parts: 9, itemId: 5000, invSlot: 4 },
    });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(4, 9)));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.readUInt16LE(14), SNAPSHOTTYPE.DOEQUIP);
    assert.equal(broadcasts.length, 1);
  });

  it('reject: sends nothing', () => {
    const { handler, sent } = makeHandler({ kind: 'reject' });
    handler.handleDoUseItem(mockSocket(), new PacketReader(body(0, 0)));
    assert.equal(sent.length, 0);
  });
});
