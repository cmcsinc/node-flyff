/**
 * RemoveItemHandler test -- REMOVEINVENITEM (0x00ff0019).
 *
 * Body: `DWORD dwId, int nNum`. dwId is the inv elem objid (= slot index).
 * Success acks a single UPDATE_ITEM snapshot with the post-remove count;
 * a full remove sends count 0 (clears the slot client-side). A rejected
 * remove sends nothing -- matches C++ silent `return`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { RemoveItemHandler } from '../../src/handlers/removeItem.handler';
import type { CPlayer } from '../../src/entities/player';
import type { PlayerManager } from '../../src/managers/player.manager';
import type { InventoryService } from '../../src/services/inventory.service';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 7 }, write: () => true, destroy: () => {} } as never;
}

/** REMOVEINVENITEM body: `DWORD dwId, int nNum`. */
function writeRemove(dwId: number, nNum: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(dwId);
  w.writeDword(nNum);
  return w.build();
}

/** Snapshot subtype WORD sits at byte 14 (SNAPSHOT|NULL_ID|count|objid|word). */
function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

function makeHandler(removeResult: unknown): { handler: RemoveItemHandler; sent: Buffer[] } {
  const sent: Buffer[] = [];
  const player = { m_idPlayer: 0xdddd } as unknown as CPlayer;
  const playerManager = {
    get: () => player,
    sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); },
  } as unknown as PlayerManager;
  const inventoryService = { removeItem: () => removeResult } as unknown as InventoryService;
  return { handler: new RemoveItemHandler({ playerManager, inventoryService }), sent };
}

describe('RemoveItemHandler', () => {
  it('acks a partial remove with UPDATE_ITEM(remaining count)', () => {
    const { handler, sent } = makeHandler({ ok: true, slot: 4, itemId: 2001, remaining: 6 });
    handler.handleRemoveItem(mockSocket(), new PacketReader(writeRemove(4, 4)));

    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.UPDATE_ITEM);
    // cType(byte16)=0 inventory, nId(byte17)=slot, cParam(byte18)=UI_NUM(0),
    // dwValue(byte19..22)=new count.
    assert.equal(sent[0]!.readUInt8(17), 4, 'slot');
    assert.equal(sent[0]!.readUInt32LE(19), 6, 'remaining count');
  });

  it('acks a full remove with UPDATE_ITEM count 0 (clears slot)', () => {
    const { handler, sent } = makeHandler({ ok: true, slot: 2, itemId: 2001, remaining: 0 });
    handler.handleRemoveItem(mockSocket(), new PacketReader(writeRemove(2, 3)));

    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.UPDATE_ITEM);
    assert.equal(sent[0]!.readUInt32LE(19), 0, 'count 0 clears the slot client-side');
  });

  it('sends nothing when the service rejects', () => {
    const { handler, sent } = makeHandler({ ok: false, reason: 'invalid' });
    handler.handleRemoveItem(mockSocket(), new PacketReader(writeRemove(0, 1)));
    assert.equal(sent.length, 0);
  });

  it('destroys the socket when the session is not in-world', () => {
    let destroyed = false;
    const sock = {
      session: { state: SessionState.IN_WORLD + 999, charId: 7 },
      write: () => true,
      destroy: () => { destroyed = true; },
    } as never;
    const { handler, sent } = makeHandler({ ok: true, slot: 0, itemId: 1, remaining: 0 });
    handler.handleRemoveItem(sock, new PacketReader(writeRemove(0, 1)));
    assert.equal(destroyed, true);
    assert.equal(sent.length, 0);
  });
});
