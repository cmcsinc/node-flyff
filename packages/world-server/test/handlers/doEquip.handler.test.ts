/**
 * DoEquipHandler test -- DOEQUIP (0x00ff000b).
 *
 * Body: `DWORD nId, int nPart[, FLOAT fVal if nPart==13]`. nId in the equip
 * range (>= MAX_INVENTORY) => unequip that part; main-bag nId => equip into nPart.
 * On success: self DOEQUIP + vicinity broadcast so peers render the gear.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { DoEquipHandler } from '../../src/handlers/doEquip.handler.js';
import { MAX_INVENTORY } from '../../src/net/snapshot/constants.js';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { ZoneManager } from '../../src/managers/zone.manager.js';
import type { EquipService } from '../../src/services/equip.service.js';

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

function makeHandler(equipStub: { equip: unknown; unequip: unknown }) {
  const sent: Buffer[] = [];
  const broadcasts: Buffer[] = [];
  const player = { m_idPlayer: 0xaaaa, m_vPos: { x: 0, y: 0, z: 0 }, m_nZoneId: 1, m_bDead: false } as unknown as CPlayer;
  const playerManager = { get: () => player, sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); } } as unknown as PlayerManager;
  const zoneManager = { broadcastAround: (_pos: unknown, _z: unknown, _r: unknown, b: Buffer) => { broadcasts.push(b); } } as unknown as ZoneManager;
  const equipService = {
    equip: () => equipStub.equip,
    unequip: () => equipStub.unequip,
  } as unknown as EquipService;
  const handler = new DoEquipHandler({ playerManager, zoneManager, equipService });
  return { handler, player, sent, broadcasts };
}

describe('DoEquipHandler', () => {
  it('main-bag nId -> equip: self + vicinity DOEQUIP', () => {
    const { handler, sent, broadcasts } = makeHandler({
      equip: { ok: true, parts: 9, itemId: 5000, invSlot: 4 },
      unequip: { ok: false, reason: 'invalid' },
    });
    handler.handleDoEquip(mockSocket(), new PacketReader(body(4, 9)));
    assert.equal(sent.length, 1, 'self confirm sent');
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.DOEQUIP);
    assert.equal(broadcasts.length, 1, 'vicinity broadcast sent');
  });

  it('equip-range nId -> unequip: self + vicinity DOEQUIP (fEquip=0)', () => {
    const { handler, sent, broadcasts } = makeHandler({
      equip: { ok: false, reason: 'invalid' },
      unequip: { ok: true, parts: 9, itemId: 5000, invSlot: 3 },
    });
    handler.handleDoEquip(mockSocket(), new PacketReader(body(MAX_INVENTORY + 9, 9)));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]![21], 0, 'fEquip=0 (unequip)');
    assert.equal(broadcasts.length, 1);
  });

  it('rejected equip sends nothing', () => {
    const { handler, sent, broadcasts } = makeHandler({
      equip: { ok: false, reason: 'not_equippable' },
      unequip: { ok: false, reason: 'invalid' },
    });
    handler.handleDoEquip(mockSocket(), new PacketReader(body(0, 9)));
    assert.equal(sent.length, 0);
    assert.equal(broadcasts.length, 0);
  });

  it('consumes the RIDE(13) trailing float without equipping', () => {
    const { handler, sent } = makeHandler({
      equip: { ok: false, reason: 'restricted' },
      unequip: { ok: false, reason: 'invalid' },
    });
    const w = new PacketWriter();
    w.writeDword(0); w.writeDword(13); w.writeFloat(1.5); // RIDE trailing float
    handler.handleDoEquip(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 0, 'RIDE rejected, float consumed, stream stays aligned');
  });
});
