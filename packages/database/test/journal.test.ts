import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal.js';
import type { JournalRow } from '../src/journal.js';

describe('Journal', () => {
  let journal: Journal;

  before(() => {
    journal = new Journal({ path: ':memory:' });
  });

  after(() => journal.close());

  it('appends a row and reads it back unreplayed', () => {
    const id = journal.append({ charId: 7, type: 'ITEM_ADD', payload: { itemId: 42, count: 1 } });
    assert.ok(typeof id === 'number' && id > 0, 'append returns a positive row id');

    const rows = journal.getUnreplayed();
    const row = rows.find((r) => r.id === id);
    assert.ok(row, 'appended row is present');
    assert.equal(row!.char_id, 7);
    assert.equal(row!.event_type, 'ITEM_ADD');
    assert.equal(row!.replayed, 0, 'new rows default to replayed=0');
    assert.deepEqual(JSON.parse(row!.payload), { itemId: 42, count: 1 });
  });

  it('round-trips arbitrary object payloads through JSON', () => {
    const id = journal.append({
      charId: 1,
      type: 'GOLD_CHANGE',
      payload: { delta: -500, reason: 'buy', shop: 'Flaris' },
    });
    const row = journal.getUnreplayed().find((r) => r.id === id)!;
    assert.deepEqual(JSON.parse(row.payload), {
      delta: -500,
      reason: 'buy',
      shop: 'Flaris',
    });
  });

  it('returns events in ascending id (insertion) order', () => {
    journal.clearAll();
    journal.append({ charId: 1, type: 'A', payload: 0 });
    journal.append({ charId: 1, type: 'B', payload: 0 });
    journal.append({ charId: 1, type: 'C', payload: 0 });

    const rows = journal.getUnreplayed();
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.event_type),
      ['A', 'B', 'C']
    );
    // ids strictly increasing
    assert.ok(rows[0].id < rows[1].id && rows[1].id < rows[2].id);
  });

  it('mixes events across characters and returns all unreplayed', () => {
    journal.clearAll();
    journal.append({ charId: 10, type: 'ITEM_ADD', payload: {} });
    journal.append({ charId: 11, type: 'LEVEL_UP', payload: { to: 2 } });
    journal.append({ charId: 10, type: 'GOLD_CHANGE', payload: { delta: 5 } });

    const rows = journal.getUnreplayed();
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.char_id),
      [10, 11, 10]
    );
    assert.equal(journal.countUnreplayed(), 3);
  });

  it('marks a row replayed so it is excluded from subsequent reads', () => {
    journal.clearAll();
    const a = journal.append({ charId: 1, type: 'X', payload: 0 });
    const b = journal.append({ charId: 1, type: 'Y', payload: 0 });

    journal.markReplayed(a);
    const remaining = journal.getUnreplayed();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, b);
    assert.equal(journal.countUnreplayed(), 1);
  });

  it('markReplayed is idempotent', () => {
    journal.clearAll();
    const id = journal.append({ charId: 1, type: 'X', payload: 0 });
    journal.markReplayed(id);
    journal.markReplayed(id); // second call must not throw
    assert.equal(journal.countUnreplayed(), 0);
  });

  it('clearAll removes every row including replayed ones', () => {
    journal.append({ charId: 1, type: 'X', payload: 0 });
    journal.append({ charId: 1, type: 'Y', payload: 0 });
    const before = journal.getUnreplayed().length;
    assert.ok(before > 0);

    journal.clearAll();
    assert.equal(journal.getUnreplayed().length, 0);
    assert.equal(journal.countUnreplayed(), 0);
  });

  it('persists created_at from the caller-supplied timestamp', () => {
    journal.clearAll();
    const fixed = 1_700_000_000_000;
    const id = journal.append({ charId: 1, type: 'T', payload: 0 }, fixed);
    const row = journal.getUnreplayed().find((r) => r.id === id)!;
    assert.equal(row.created_at, fixed);
  });
});

describe('Journal file-backed instance', () => {
  // Regression: ensure a non-:memory: path creates its parent directory and
  // survives a reopen so the boot recovery path can read prior unprocessed rows.
  it('creates the parent dir and replays rows across reopen', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'flyff-journal-'));
    const path = `${tmpDir}/nested/world_test.sqlite3`;
    const stamp = 1_700_000_000_001;

    const first = new Journal({ path });
    first.append({ charId: 99, type: 'ITEM_ADD', payload: { itemId: 1 } }, stamp);
    first.close();

    const second = new Journal({ path });
    const rows: JournalRow[] = second.getUnreplayed();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].char_id, 99);
    assert.equal(rows[0].created_at, stamp);
    second.markReplayed(rows[0].id);
    assert.equal(second.countUnreplayed(), 0);
    second.close();
  });
});
