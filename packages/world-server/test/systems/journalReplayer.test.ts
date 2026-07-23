import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { Journal } from '@flyff/database';
import { JournalReplayer } from '../../src/systems/journalReplayer';
import type { JournalRow } from '@flyff/database';

function makeLogger() {
  const logs: Array<{ level: string; msg: string; obj?: unknown }> = [];
  return {
    logs,
    logger: {
      info: (obj: unknown, msg: string) => logs.push({ level: 'info', msg, obj }),
      warn: (obj: unknown, msg: string) => logs.push({ level: 'warn', msg, obj }),
      error: (obj: unknown, msg: string) => logs.push({ level: 'error', msg, obj }),
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child: () => makeLogger().logger,
    },
  };
}

describe('JournalReplayer', () => {
  let journal: Journal;

  before(() => {
    journal = new Journal({ path: ':memory:' });
  });
  after(() => journal.close());

  it('returns an empty summary when there is nothing to replay', async () => {
    journal.clearAll();
    const { logger } = makeLogger();
    const r = new JournalReplayer({ journal, logger: logger as never });
    const summary = await r.recover();
    assert.deepEqual(summary, { total: 0, replayed: 0, skipped: 0 });
  });

  it('dispatches each event to the registered handler and marks it replayed', async () => {
    journal.clearAll();
    const { logger } = makeLogger();
    const r = new JournalReplayer({ journal, logger: logger as never });

    const seen: JournalRow[] = [];
    r.register('ITEM_ADD', async (row) => {
      seen.push(row);
    });

    journal.append({ charId: 5, type: 'ITEM_ADD', payload: { itemId: 1 } });
    journal.append({ charId: 5, type: 'ITEM_ADD', payload: { itemId: 2 } });

    const summary = await r.recover();
    assert.equal(summary.total, 2);
    assert.equal(summary.replayed, 2);
    assert.equal(summary.skipped, 0);
    assert.equal(seen.length, 2);
    assert.equal(journal.countUnreplayed(), 0, 'all rows flagged replayed');
    assert.deepEqual(
      seen.map((s) => JSON.parse(s.payload)),
      [{ itemId: 1 }, { itemId: 2 }]
    );
  });

  it('leaves events with no registered handler unreplayed and skips them', async () => {
    journal.clearAll();
    const { logger, logs } = makeLogger();
    const r = new JournalReplayer({ journal, logger: logger as never });

    journal.append({ charId: 1, type: 'GOLD_CHANGE', payload: { delta: 10 } });

    const summary = await r.recover();
    assert.equal(summary.replayed, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(journal.countUnreplayed(), 1, 'unhandled row left unreplayed');

    const warns = logs.filter((l) => l.level === 'warn');
    assert.equal(warns.length, 1, 'one warn logged for the unhandled type');
    assert.match((warns[0]!.obj as { type: string }).type, /GOLD_CHANGE/);
  });

  it('deduplicates the no-handler log to one warn per type across many rows', async () => {
    journal.clearAll();
    const { logger, logs } = makeLogger();
    const r = new JournalReplayer({ journal, logger: logger as never });

    // 29 EXP_GAIN rows (the crash that motivated this) + 1 of another type.
    for (let i = 0; i < 29; i++) {
      journal.append({ charId: 5, type: 'EXP_GAIN', payload: { amount: 2 } });
    }
    journal.append({ charId: 5, type: 'ITEM_ADD', payload: { itemId: 9 } });

    const summary = await r.recover();
    assert.equal(summary.replayed, 0);
    assert.equal(summary.skipped, 30);
    assert.equal(journal.countUnreplayed(), 30, 'all unhandled rows left unreplayed');

    const warns = logs.filter((l) => l.level === 'warn');
    assert.equal(warns.length, 2, 'one warn per unhandled type, not per row');
    const expGain = warns.find((w) => (w.obj as { type: string }).type === 'EXP_GAIN')!;
    assert.equal((expGain.obj as { count: number }).count, 29);
    const errors = logs.filter((l) => l.level === 'error');
    assert.equal(errors.length, 0, 'no per-row error spam');
  });

  it('replays events in ascending id order across mixed types', async () => {
    journal.clearAll();
    const { logger } = makeLogger();
    const r = new JournalReplayer({ journal, logger: logger as never });

    const order: string[] = [];
    r.register('A', async () => { order.push('A'); });
    r.register('B', async () => { order.push('B'); });

    journal.append({ charId: 1, type: 'B', payload: 0 });
    journal.append({ charId: 1, type: 'A', payload: 0 });
    journal.append({ charId: 1, type: 'B', payload: 0 });

    await r.recover();
    assert.deepEqual(order, ['B', 'A', 'B']);
  });

  it('aborts recovery when a handler throws, leaving the row unreplayed', async () => {
    journal.clearAll();
    const { logger } = makeLogger();
    const r = new JournalReplayer({ journal, logger: logger as never });

    r.register('BOOM', async () => {
      throw new Error('handler failure');
    });

    journal.append({ charId: 1, type: 'BOOM', payload: 0 });
    await assert.rejects(() => r.recover(), /handler failure/);
    assert.equal(journal.countUnreplayed(), 1, 'failed row left unreplayed');
  });
});
