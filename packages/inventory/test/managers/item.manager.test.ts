/**
 * ItemManager test -- spawn broadcasts ADD_OBJ, 3-min decay fires DEL_OBJ,
 * looted remove clears the timer (no double DEL_OBJ).
 *
 * Uses the per-test `t.mock.timers` (not the shared `mock` import) so each test
 * gets its own MockTimers that auto-cleans -- re-enabling the shared singleton
 * throws "MockTimers is already enabled".
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ItemManager } from '../../src/managers/item.manager';
import { FIRST_ITEM_ID } from '../../src/entities/item';

function snapshotSubtype(payload: Buffer): number {
  // [SNAPSHOT:4][NULL_ID:4][count:2][objid:4][subtype:2] -> offset 14.
  return payload.readUInt16LE(14);
}

function mockZone(): { zone: unknown; broadcasts: Buffer[] } {
  const broadcasts: Buffer[] = [];
  const zone = { broadcastAround: (_p: unknown, _z: number, _r: number, b: Buffer) => { broadcasts.push(b); return 1; } };
  return { zone: zone as never, broadcasts };
}

describe('ItemManager', () => {
  it('spawn registers + broadcasts ADD_OBJ; decay fires DEL_OBJ after 3 min', (t) => {
    t.mock.timers.enable();
    const { zone, broadcasts } = mockZone();
    const mgr = new ItemManager({ zoneManager: zone, now: () => 1000 });

    const id = mgr.spawn({ itemId: 2950, count: 1, ownerId: 5, pos: { x: 1, y: 2, z: 3 }, zoneId: 1 });
    assert.equal(id, FIRST_ITEM_ID);
    assert.equal(mgr.get(id)?.m_dwItemId, 2950);
    assert.equal(broadcasts.length, 1);
    assert.equal(snapshotSubtype(broadcasts[0]!), 0x00f0); // ADD_OBJ

    t.mock.timers.tick(3 * 60_000 - 1);
    assert.ok(mgr.get(id), 'still alive just before 3 min');

    t.mock.timers.tick(2);
    assert.equal(mgr.get(id), undefined, 'decayed');
    assert.equal(broadcasts.length, 2);
    assert.equal(snapshotSubtype(broadcasts[1]!), 0x00f1); // DEL_OBJ
  });

  it('remove (loot) clears the decay timer so expire never double-fires', (t) => {
    t.mock.timers.enable();
    const { zone, broadcasts } = mockZone();
    const mgr = new ItemManager({ zoneManager: zone, now: () => 0 });

    const id = mgr.spawn({ itemId: 1, count: 1, ownerId: 1, pos: { x: 0, y: 0, z: 0 }, zoneId: 1 });
    assert.equal(broadcasts.length, 1); // ADD_OBJ

    const removed = mgr.remove(id);
    assert.ok(removed);
    assert.equal(mgr.get(id), undefined);
    assert.equal(broadcasts.length, 2); // DEL_OBJ from remove

    t.mock.timers.tick(3 * 60_000 + 1);
    assert.equal(broadcasts.length, 2); // timer cleared -- no second DEL_OBJ
  });

  it('shutdown clears all timers + items', (t) => {
    t.mock.timers.enable();
    const { zone, broadcasts } = mockZone();
    const mgr = new ItemManager({ zoneManager: zone, now: () => 0 });
    const id = mgr.spawn({ itemId: 1, count: 1, ownerId: 1, pos: { x: 0, y: 0, z: 0 }, zoneId: 1 });

    mgr.shutdown();
    assert.equal(mgr.get(id), undefined);
    t.mock.timers.tick(3 * 60_000 + 1);
    assert.equal(broadcasts.length, 1); // only the spawn ADD_OBJ -- no decay DEL_OBJ
  });
});
