/**
 * TASKBAR serializer byte-layout test.
 *
 * Pins the JOIN taskbar snapshot (SNAPSHOTTYPE_TASKBAR = 0x0097). Body is the
 * storing branch of `CUserTaskBar::Serialize` (UserTaskBar.cpp:61): three
 * counts (applet/item/queue) each leading their entries, trailing actionPoint.
 * We ship only the item grid, so applet/queue counts are 0.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { TaskBarSnapshotSerializer } from '../../../src/net/snapshot/taskbar.serializer';
import { NULL_ID, SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM } from '../../../src/net/snapshot/constants';
import type { Shortcut } from '@flyff/entities';

function emptyGrid(): Shortcut[][] {
  return Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
    Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 })),
  );
}

describe('TaskBarSnapshotSerializer.build', () => {
  it('frames an empty grid as applet=0/item=0/queue=0/action=0', () => {
    const buf = new TaskBarSnapshotSerializer().build(0x1234, emptyGrid());
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), 0x1234);
    assert.equal(r.readWord(), 0x0097);
    assert.equal(r.readDword(), 0, 'appletCount');
    assert.equal(r.readDword(), 0, 'itemCount');
    assert.equal(r.readDword(), 0, 'queueCount');
    assert.equal(r.readDword(), 0, 'actionPoint');
  });

  it('emits a skill entry at [1][2] and a chat entry with szString', () => {
    const grid = emptyGrid();
    grid[1]![2] = { dwShortcut: SHORTCUT.SKILLFUN, dwId: 42, dwType: 1, dwIndex: 2, dwUserId: 3, dwData: 4 };
    grid[0]![0] = { dwShortcut: SHORTCUT.CHAT, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0, szString: '/go Flaris' };

    const buf = new TaskBarSnapshotSerializer().build(0xabcd, grid);
    const r = new PacketReader(buf);
    r.readDword(); r.readDword(); r.readWord(); r.readDword(); r.readWord(); // header + 0x0097
    assert.equal(r.readDword(), 0, 'appletCount');
    assert.equal(r.readDword(), 2, 'itemCount -- two non-empty slots');

    // Entries are emitted in row-major order, so [0][0] (chat) precedes [1][2].
    const i0 = r.readDword(); const j0 = r.readDword();
    assert.equal(i0, 0); assert.equal(j0, 0);
    assert.equal(r.readDword(), SHORTCUT.CHAT);
    r.readDword(); r.readDword(); r.readDword(); r.readDword(); r.readDword(); // dwId..dwData
    assert.equal(r.readString(), '/go Flaris', 'chat szString trailer');

    const i1 = r.readDword(); const j1 = r.readDword();
    assert.equal(i1, 1); assert.equal(j1, 2);
    assert.equal(r.readDword(), SHORTCUT.SKILLFUN);
    assert.equal(r.readDword(), 42, 'dwId');
    r.readDword(); r.readDword(); r.readDword(); r.readDword();

    assert.equal(r.readDword(), 0, 'queueCount');
    assert.equal(r.readDword(), 0, 'actionPoint');
  });
});
