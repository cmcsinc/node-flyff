/**
 * TaskBarHandler test -- ADDITEMTASKBAR / REMOVEITEMTASKBAR parse + delegate.
 *
 * ADDITEMTASKBAR body: `BYTE nSlotIndex, BYTE nIndex, DWORD x6` (+ String when
 * SHORTCUT_CHAT). REMOVEITEMTASKBAR body: `BYTE nSlotIndex, BYTE nIndex`.
 * Neither acks on the wire; success is observed via the mutated grid slot.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { TaskBarHandler } from '../../src/handlers/taskbar.handler';
import { TaskBarService } from '../../src/services/taskbar.service';
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM } from '../../src/net/snapshot/constants';
import type { Shortcut } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';

function emptyGrid(): Shortcut[][] {
  return Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
    Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE })),
  );
}

function makeHandler() {
  const player = { m_idPlayer: 0xcccc, m_aSlotItem: emptyGrid() };
  const playerManager = { get: () => player } as unknown as PlayerManager;
  const taskbarService = new TaskBarService();
  const handler = new TaskBarHandler({ playerManager, taskbarService });
  return { handler, player };
}

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed = true; },
    _destroyed: () => destroyed,
  } as never;
}

describe('TaskBarHandler.handleAddItem', () => {
  it('parses a skill shortcut into the grid', () => {
    const w = new PacketWriter();
    w.writeByte(1); w.writeByte(2);                       // slotIndex, index
    w.writeDword(SHORTCUT.SKILLFUN); w.writeDword(42);   // dwShortcut, dwId
    w.writeDword(0); w.writeDword(0); w.writeDword(0); w.writeDword(0); // dwType, dwIndex, dwUserId, dwData
    const { handler, player } = makeHandler();
    handler.handleAddItem(mockSocket(), new PacketReader(w.build()));
    assert.equal(player.m_aSlotItem[1]![2]!.dwShortcut, SHORTCUT.SKILLFUN);
    assert.equal(player.m_aSlotItem[1]![2]!.dwId, 42);
  });

  it('parses the szString trailer for a chat macro', () => {
    const w = new PacketWriter();
    w.writeByte(0); w.writeByte(0);
    w.writeDword(SHORTCUT.CHAT); w.writeDword(0); w.writeDword(0);
    w.writeDword(0); w.writeDword(0); w.writeDword(0);
    w.writeString('/go Flaris');
    const { handler, player } = makeHandler();
    handler.handleAddItem(mockSocket(), new PacketReader(w.build()));
    assert.equal(player.m_aSlotItem[0]![0]!.dwShortcut, SHORTCUT.CHAT);
    assert.equal(player.m_aSlotItem[0]![0]!.szString, '/go Flaris');
  });

  it('silently rejects an out-of-range slot without mutating the grid', () => {
    const w = new PacketWriter();
    w.writeByte(MAX_SLOT_ITEM_COUNT); w.writeByte(0);    // slotIndex OOB
    w.writeDword(SHORTCUT.SKILLFUN); w.writeDword(1); w.writeDword(0); w.writeDword(0); w.writeDword(0); w.writeDword(0);
    const { handler, player } = makeHandler();
    handler.handleAddItem(mockSocket(), new PacketReader(w.build()));
    assert.equal(player.m_aSlotItem[0]![0]!.dwShortcut, SHORTCUT.NONE);
  });

  it('destroys the socket when not in world', () => {
    const w = new PacketWriter();
    w.writeByte(0); w.writeByte(0); w.writeDword(0); w.writeDword(0); w.writeDword(0); w.writeDword(0); w.writeDword(0); w.writeDword(0);
    const { handler } = makeHandler();
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleAddItem(sock, new PacketReader(w.build()));
    assert.equal((sock as { _destroyed: () => boolean })._destroyed(), true);
  });
});

describe('TaskBarHandler.handleRemoveItem', () => {
  it('clears the grid slot', () => {
    const { handler, player } = makeHandler();
    player.m_aSlotItem[3]![4] = { dwShortcut: SHORTCUT.SKILLFUN, dwId: 9, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 };
    const w = new PacketWriter();
    w.writeByte(3); w.writeByte(4);
    handler.handleRemoveItem(mockSocket(), new PacketReader(w.build()));
    assert.equal(player.m_aSlotItem[3]![4]!.dwShortcut, SHORTCUT.NONE);
  });
});
