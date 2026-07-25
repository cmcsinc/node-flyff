/**
 * SkillTaskBarHandler test -- SKILLTASKBAR (0xffffff0e) action-slot upload.
 *
 * Body: `[DWORD nCount] nCount*{ [BYTE nIndex][DWORD x6] }`. Client always
 * sends all MAX_SLOT_QUEUE(5) slots; success is observed via the mutated
 * `m_aSlotQueue`. No ack on the wire.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { SkillTaskBarHandler } from '../../src/handlers/skillTaskbar.handler';
import { TaskBarService } from '../../src/services/taskbar.service';
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SLOT_QUEUE } from '@flyff/world-core';
import type { Shortcut } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';

function emptyGrid(): Shortcut[][] {
  return Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
    Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE })),
  );
}

function emptyQueue(): Shortcut[] {
  return Array.from({ length: MAX_SLOT_QUEUE }, () => ({ dwShortcut: SHORTCUT.NONE }));
}

function mockSocket(state = SessionState.IN_WORLD, charId = 7) {
  let destroyed = false;
  return {
    session: { state, charId },
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

function buildPacket(slots: Array<{ index: number; id: number }>): Buffer {
  const w = new PacketWriter();
  w.writeDword(slots.length);
  for (const s of slots) {
    w.writeByte(s.index);
    w.writeDword(SHORTCUT.SKILLFUN);   // dwShortcut
    w.writeDword(s.id);                // dwId
    w.writeDword(0);                   // dwType
    w.writeDword(0);                   // dwIndex
    w.writeDword(0);                   // dwUserId
    w.writeDword(0);                   // dwData
  }
  return w.build();
}

describe('SkillTaskBarHandler.handleSkillTaskBar', () => {
  it('writes the queue at the uploaded indexes and leaves others empty', () => {
    const player = { m_idPlayer: 7, m_aSlotItem: emptyGrid(), m_aSlotQueue: emptyQueue() };
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const svc = new TaskBarService();
    const handler = new SkillTaskBarHandler({ playerManager, taskbarService: svc });

    handler.handleSkillTaskBar(mockSocket() as never, new PacketReader(buildPacket([
      { index: 0, id: 50 }, { index: 2, id: 51 }, { index: 4, id: 52 },
    ])));

    assert.equal(player.m_aSlotQueue[0]!.dwId, 50);
    assert.equal(player.m_aSlotQueue[2]!.dwId, 51);
    assert.equal(player.m_aSlotQueue[4]!.dwId, 52);
    assert.equal(player.m_aSlotQueue[1]!.dwShortcut, SHORTCUT.NONE, 'untouched queue slot stays empty');
    assert.equal(player.m_aSlotQueue[3]!.dwShortcut, SHORTCUT.NONE);
  });

  it('persists the queue fire-and-forget when a hook is wired (action-slot survives logout)', async () => {
    const saved: string[] = [];
    const svc = new TaskBarService((_id, json) => { saved.push(json); return Promise.resolve(); });
    const player = { m_idPlayer: 7, m_aSlotItem: emptyGrid(), m_aSlotQueue: emptyQueue() };
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const handler = new SkillTaskBarHandler({ playerManager, taskbarService: svc });

    handler.handleSkillTaskBar(mockSocket() as never, new PacketReader(buildPacket([{ index: 0, id: 99 }])));
    await new Promise((r) => setImmediate(r));

    assert.equal(saved.length, 1);
    const blob = JSON.parse(saved[0]!) as { queue: Array<{ i: number; dwId: number }> };
    assert.equal(blob.queue.length, 1);
    assert.equal(blob.queue[0]!.i, 0);
    assert.equal(blob.queue[0]!.dwId, 99);
  });

  it('drops the packet silently when nCount > MAX_SLOT_QUEUE', () => {
    const player = { m_idPlayer: 7, m_aSlotItem: emptyGrid(), m_aSlotQueue: emptyQueue() };
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const handler = new SkillTaskBarHandler({ playerManager, taskbarService: new TaskBarService() });

    const w = new PacketWriter();
    w.writeDword(MAX_SLOT_QUEUE + 1);
    handler.handleSkillTaskBar(mockSocket() as never, new PacketReader(w.build()));

    assert.equal(player.m_aSlotQueue.every((s) => s.dwShortcut === SHORTCUT.NONE), true, 'queue untouched on reject');
  });

  it('destroys when not IN_WORLD', () => {
    const player = { m_idPlayer: 7, m_aSlotItem: emptyGrid(), m_aSlotQueue: emptyQueue() };
    const playerManager = { get: () => player } as unknown as PlayerManager;
    const handler = new SkillTaskBarHandler({ playerManager, taskbarService: new TaskBarService() });
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleSkillTaskBar(sock as never, new PacketReader(buildPacket([{ index: 0, id: 1 }])));
    assert.equal(sock._destroyed, true);
  });
});
