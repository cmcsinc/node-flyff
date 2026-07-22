import type { Journal, JournalRow } from '@flyff/database';
import type { Logger } from '@flyff/core';

/**
 * Boot-time crash recovery for the WAL journal.
 *
 * Runs BEFORE the world TCP listener opens (see `index.ts`): reads every
 * `replayed = 0` row from the journal, dispatches each to the registered
 * handler for its event type, and flags it replayed on success. Prevents item
 * dupes / gold rollbacks when the server crashed between journalling a mutation
 * and the 30s main-DB flush.
 *
 * Handlers are registered by services as they come online (inventory service
 * registers `ITEM_ADD` / `ITEM_REMOVE`, etc.). An event type with no handler is
 * left unreplayed and logged once at warn (per type, not per row) -- it means a
 * newer server build produced an event this build cannot replay, which an
 * operator must investigate rather than silently drop.
 *
 * @module systems/journalReplayer
 */

export type Replayer = (row: JournalRow) => Promise<void>;

export interface JournalReplayerDeps {
  readonly journal: Journal;
  readonly logger: Logger;
}

export interface RecoverySummary {
  readonly total: number;
  readonly replayed: number;
  readonly skipped: number;
}

export class JournalReplayer {
  private readonly handlers = new Map<string, Replayer>();

  constructor(private readonly deps: JournalReplayerDeps) {}

  /** Register a replay handler for one event type. Idempotent. */
  register(type: string, fn: Replayer): void {
    this.handlers.set(type, fn);
  }

  /**
   * Replay every unprocessed journal row, in insertion order, then mark each
   * replayed. Resolves only when the queue is drained (or a handler throws).
   *
   * A throwing handler aborts recovery -- the row stays unreplayed and the
   * process should exit rather than open the listener on partial state.
   */
  async recover(): Promise<RecoverySummary> {
    const rows = this.deps.journal.getUnreplayed();
    if (rows.length === 0) {
      return { total: 0, replayed: 0, skipped: 0 };
    }

    this.deps.logger.info({ count: rows.length }, 'Replaying journaled events from crash recovery');

    let replayed = 0;
    let skipped = 0;
    // Missing handlers are tallied per type and logged once AFTER the loop -- N
    // rows of the same unhandled type are one investigation, not N identical
    // errors. Rows stay unreplayed so a future build's handler can pick them up.
    const missing = new Map<string, number>();
    for (const row of rows) {
      const handler = this.handlers.get(row.event_type);
      if (!handler) {
        missing.set(row.event_type, (missing.get(row.event_type) ?? 0) + 1);
        skipped++;
        continue;
      }
      await handler(row);
      this.deps.journal.markReplayed(row.id);
      replayed++;
    }

    for (const [type, count] of missing) {
      this.deps.logger.warn(
        { type, count },
        'No replayer registered for journaled event type -- leaving unreplayed'
      );
    }

    this.deps.logger.info({ replayed, skipped }, 'Crash recovery complete');
    return { total: rows.length, replayed, skipped };
  }
}
