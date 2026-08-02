/**
 * DoEquipHandler test -- DOEQUIP (0x00ff000b).
 *
 * Body: `DWORD nId, int nPart[, FLOAT fVal if nPart==13]`. nId is the item's
 * STABLE m_dwObjId. Equip-vs-unequip is decided by the item's CURRENT slot
 * (C++ IsEquip), found via objid scan -- NOT by nId's value, because a
 * session-equipped item keeps its original bag-slot objid. Wire nId echoes the
 * stable objid so the client's GetAtId(nId) resolves the item.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { DoEquipHandler } from '../../src/handlers/doEquip.handler';
import { INVENTORY_SLOTS, MAX_INVENTORY } from '@flyff/world-core';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { CPlayer } from '@flyff/entities';
import type { InventorySlot } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { EquipService } from '../../src/services/equip.service';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function body(nId: number, nPart: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(nId);
  w.writeDword(nPart);
  return w.build();
}

function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

function makeHandler(
  equipStub: { equip: unknown; unequip: unknown },
  inventory: Record<number, InventorySlot>,
  opts: {
    getItem?: (id: number) => { equip_slot?: number; flight_speed?: number } | undefined;
    isFlightSpeedValid?: (prop: { flight_speed?: number }, claimed: number) => boolean;
    notified?: number[];
  } = {},
) {
  const broadcasts: Buffer[] = [];
  const m_Inventory = new Array<InventorySlot | null>(INVENTORY_SLOTS).fill(null);
  for (const [k, v] of Object.entries(inventory)) m_Inventory[Number(k)] = v;
  const player = {
    m_idPlayer: 0xaaaa, m_vPos: { x: 0, y: 0, z: 0 }, m_nZoneId: 1, m_bDead: false, m_Inventory,
    findSlotByObjId: CPlayer.prototype.findSlotByObjId,
  } as unknown as CPlayer;
  const playerManager = { get: () => player } as unknown as PlayerManager;
  const zoneManager = { broadcastAround: (_pos: unknown, _z: unknown, _r: unknown, b: Buffer) => { broadcasts.push(b); } } as unknown as ZoneManager;
  const equipService = {
    equip: () => equipStub.equip,
    unequip: () => equipStub.unequip,
  } as unknown as EquipService;
  const handler = new DoEquipHandler({
    playerManager, zoneManager, equipService,
    getItem: opts.getItem ?? (() => undefined),
    isFlightSpeedValid: opts.isFlightSpeedValid ?? ((prop, claimed) =>
      prop.flight_speed === undefined || Math.abs(prop.flight_speed - claimed) < 1e-6),
    notify: (_p, tid) => { (opts.notified ??= []).push(tid); },
  });
  return { handler, player, broadcasts };
}

describe('DoEquipHandler', () => {
  it('bag item (objid=4 at slot 4) -> equip: wire nId echoes the stable objid', () => {
    const { handler, broadcasts } = makeHandler(
      { equip: { ok: true, parts: 9, itemId: 5000, invSlot: 4, objid: 4 }, unequip: { ok: false, reason: 'invalid' } },
      { 4: { itemId: 5000, count: 1, objid: 4 } },
    );
    handler.handleDoEquip(mockSocket(), new PacketReader(body(4, 9)));
    assert.equal(broadcasts.length, 1, 'one vicinity broadcast (self + peers)');
    assert.equal(subtype(broadcasts[0]!), SNAPSHOTTYPE.DOEQUIP);
    assert.equal(broadcasts[0]![16], 4, 'wire nId = stable objid (bag slot here)');
    assert.equal(broadcasts[0]![21], 1, 'fEquip = 1 (equipping)');
  });

  it('session-equipped item (objid=7, now at equip slot) -> unequip by objid, NOT nId range', () => {
    // Item was equipped from bag slot 7 this session; m_dwObjId stays 7 (stable),
    // so the client sends nId=7 (< MAX_INVENTORY). The item now lives at the equip
    // slot. nId-range discrimination would misroute this to equip + reject; the
    // objid scan finds it at the equip slot and unequips.
    const { handler, broadcasts } = makeHandler(
      { equip: { ok: false, reason: 'invalid' }, unequip: { ok: true, parts: 9, itemId: 5000, invSlot: 0, objid: 7 } },
      { [MAX_INVENTORY + 9]: { itemId: 5000, count: 1, objid: 7 } },
    );
    handler.handleDoEquip(mockSocket(), new PacketReader(body(7, 9)));
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0]![16], 7, 'wire nId = stable objid (original bag slot), NOT the equip slot');
    assert.equal(broadcasts[0]![21], 0, 'fEquip = 0 (unequipping)');
  });

  it('unknown objid -> nothing sent', () => {    const { handler, broadcasts } = makeHandler(
      { equip: { ok: false, reason: 'invalid' }, unequip: { ok: false, reason: 'invalid' } },
      {},
    );
    handler.handleDoEquip(mockSocket(), new PacketReader(body(99, 9)));
    assert.equal(broadcasts.length, 0);
  });

  it('RIDE(13) item: float read from prop, speed-tamper rejects with a notice', () => {
    // Client sends nPart=13 + the trailing fFlightSpeed. The handler resolves the
    // item's OWN equip_slot (not nPart) to decide the float is on the wire, then
    // compares it to the prop's flight_speed. A mismatch -> MODIFY_FLIGHT_SPEED
    // (3457) notice, no equip, stream consumed.
    const notified: number[] = [];
    const { handler, broadcasts } = makeHandler(
      { equip: { ok: true, parts: 13, itemId: 5000, invSlot: 0, objid: 0 }, unequip: { ok: false, reason: 'invalid' } },
      { 0: { itemId: 5000, count: 1, objid: 0 } },
      {
        getItem: () => ({ equip_slot: 13, flight_speed: 0.0023 }),
        notified,
      },
    );
    const w = new PacketWriter();
    w.writeDword(0); w.writeDword(13); w.writeFloat(0.099); // tampered speed
    handler.handleDoEquip(mockSocket(), new PacketReader(w.build()));
    assert.equal(broadcasts.length, 0, 'tampered speed -> no equip broadcast');
    assert.deepEqual(notified, [3457], 'MODIFY_FLIGHT_SPEED notice sent');
  });

  it('RIDE(13) item: double-click (nPart=-1) still reads the float', () => {
    // nPart=-1 is the normal equip UX; the old `nPart === PARTS_RIDE` check missed
    // it and left the float in the buffer. The float must be consumed regardless.
    const { handler, broadcasts } = makeHandler(
      { equip: { ok: true, parts: 13, itemId: 5000, invSlot: 0, objid: 0 }, unequip: { ok: false, reason: 'invalid' } },
      { 0: { itemId: 5000, count: 1, objid: 0 } },
      { getItem: () => ({ equip_slot: 13, flight_speed: 0.0023 }) },
    );
    const w = new PacketWriter();
    w.writeDword(0); w.writeDword(0xffffffff); w.writeFloat(0.0023); // nPart=-1, valid speed
    handler.handleDoEquip(mockSocket(), new PacketReader(w.build()));
    assert.equal(broadcasts.length, 1, 'valid speed -> equip proceeds');
    assert.equal(broadcasts[0]![21], 1, 'fEquip = 1');
  });
});
