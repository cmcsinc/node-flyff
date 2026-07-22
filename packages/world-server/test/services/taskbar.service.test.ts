/**
 * TaskBarService test -- add/remove hotkey shortcut + chat-macro cap.
 *
 * Bind stores into m_aSlotItem[slotIndex][index]; remove clears it back to
 * SHORTCUT.NONE. A chat-macro add is rejected once the grid already holds
 * more than MAX_SHORTCUT_CHAT (9) of them (C++ `OnAddItemTaskBar:2231`).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TaskBarService, encodeTaskBar, decodeTaskBar } from '../../src/services/taskbar.service.js';
import type { Shortcut } from '../../src/entities/player.js';
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM } from '../../src/net/snapshot/constants.js';

function makePlayer(): { m_idPlayer?: number; m_aSlotItem: Shortcut[][] } {
  return {
    m_idPlayer: 77,
    m_aSlotItem: Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
      Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE })),
    ),
  };
}

function chatSlot(text = 'hi'): Shortcut {
  return { dwShortcut: SHORTCUT.CHAT, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0, szString: text };
}

function skillSlot(id = 1): Shortcut {
  return { dwShortcut: SHORTCUT.SKILLFUN, dwId: id, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 };
}

describe('TaskBarService.addItem', () => {
  it('stores a skill shortcut into the requested slot', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    const res = svc.addItem(player, 2, 5, skillSlot(42));
    assert.equal(res.ok, true);
    assert.equal(player.m_aSlotItem[2]![5]!.dwShortcut, SHORTCUT.SKILLFUN);
    assert.equal(player.m_aSlotItem[2]![5]!.dwId, 42);
  });

  it('overwrites an existing binding in the same slot', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    svc.addItem(player, 0, 0, skillSlot(1));
    svc.addItem(player, 0, 0, skillSlot(2));
    assert.equal(player.m_aSlotItem[0]![0]!.dwId, 2);
  });

  it('accepts a chat macro while fewer than MAX_SHORTCUT_CHAT exist', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    for (let i = 0; i < 9; i++) player.m_aSlotItem[0]![i] = chatSlot(`m${i}`);
    const res = svc.addItem(player, 1, 0, chatSlot('tenth'));
    assert.equal(res.ok, true);
    assert.equal(player.m_aSlotItem[1]![0]!.dwShortcut, SHORTCUT.CHAT);
  });

  it('rejects a chat macro once the grid already holds more than MAX_SHORTCUT_CHAT', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    // 10 chat macros already bound -> adding an 11th is rejected (count 10 > 9).
    for (let i = 0; i < 10; i++) player.m_aSlotItem[0]![i] = chatSlot(`m${i}`);
    const res = svc.addItem(player, 1, 0, chatSlot('eleventh'));
    assert.equal(res.ok, false);
    assert.equal((res as { reason: string }).reason, 'too_many_chat');
    // Rejected add leaves the target slot untouched.
    assert.equal(player.m_aSlotItem[1]![0]!.dwShortcut, SHORTCUT.NONE);
  });

  it('never rejects non-chat shortcuts regardless of grid fill', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    for (let i = 0; i < 10; i++) player.m_aSlotItem[0]![i] = chatSlot(`m${i}`);
    const res = svc.addItem(player, 1, 0, skillSlot(99));
    assert.equal(res.ok, true);
    assert.equal(player.m_aSlotItem[1]![0]!.dwShortcut, SHORTCUT.SKILLFUN);
  });
});

describe('TaskBarService.removeItem', () => {
  it('clears the slot back to SHORTCUT.NONE', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    svc.addItem(player, 3, 4, skillSlot(7));
    svc.removeItem(player, 3, 4);
    assert.equal(player.m_aSlotItem[3]![4]!.dwShortcut, SHORTCUT.NONE);
  });
});

describe('TaskBarService persistence', () => {
  it('fire-and-forgets an encoded grid on add when a persist hook is wired', async () => {
    const saved: Array<{ charId: number; json: string }> = [];
    const svc = new TaskBarService((charId, json) => { saved.push({ charId, json }); return Promise.resolve(); });
    const player = makePlayer();
    svc.addItem(player, 1, 2, skillSlot(42));
    // Fire-and-forget -- let the microtask drain.
    await new Promise((r) => setImmediate(r));
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.charId, 77);
    assert.deepEqual(JSON.parse(saved[0]!.json), [{ i: 1, j: 2, dwShortcut: SHORTCUT.SKILLFUN, dwId: 42, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 }]);
  });

  it('persists on remove as well', async () => {
    const saved: string[] = [];
    const svc = new TaskBarService((_id, json) => { saved.push(json); return Promise.resolve(); });
    const player = makePlayer();
    svc.addItem(player, 0, 0, skillSlot(1));
    svc.removeItem(player, 0, 0);
    await new Promise((r) => setImmediate(r));
    assert.equal(saved.length, 2, 'add then remove each persist');
    assert.deepEqual(JSON.parse(saved[1]!), [], 'remove leaves an empty grid');
  });

  it('does not persist when no hook is wired (unit-test default)', () => {
    const svc = new TaskBarService();
    const player = makePlayer();
    svc.addItem(player, 0, 0, skillSlot(1)); // must not throw
    assert.equal(player.m_aSlotItem[0]![0]!.dwId, 1);
  });
});

describe('encodeTaskBar / decodeTaskBar round-trip', () => {
  it('round-trips a mixed grid through the JSON column', () => {
    const grid = makePlayer().m_aSlotItem;
    grid[0]![0] = chatSlot('hi');
    grid[7]![8] = skillSlot(99);
    const json = encodeTaskBar(grid);
    const back = decodeTaskBar(json);
    assert.equal(back[0]![0]!.dwShortcut, SHORTCUT.CHAT);
    assert.equal(back[0]![0]!.szString, 'hi');
    assert.equal(back[7]![8]!.dwShortcut, SHORTCUT.SKILLFUN);
    assert.equal(back[7]![8]!.dwId, 99);
    assert.equal(back[3]![3]!.dwShortcut, SHORTCUT.NONE, 'untouched slots stay empty');
  });

  it('null / unreadable column yields an all-empty grid', () => {
    assert.equal(decodeTaskBar(null)[0]![0]!.dwShortcut, SHORTCUT.NONE);
    assert.equal(decodeTaskBar('')[0]![0]!.dwShortcut, SHORTCUT.NONE);
    assert.equal(decodeTaskBar('{bad json')[0]![0]!.dwShortcut, SHORTCUT.NONE);
  });

  it('drops out-of-range entries defensively', () => {
    const json = JSON.stringify([{ i: 99, j: 0, dwShortcut: SHORTCUT.SKILLFUN, dwId: 1 }]);
    assert.equal(decodeTaskBar(json).every((row) => row.every((s) => s.dwShortcut === SHORTCUT.NONE)), true);
  });
});
