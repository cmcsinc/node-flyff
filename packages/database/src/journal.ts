import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal structural logger the journal needs. Pino (and the test mocks)
 * satisfy this shape, so the database package does not depend on `@flyff/core`.
 */
export interface JournalLogger {
  warn: (obj: unknown, msg: string) => void;
}

/**
 * Hybrid WAL journal — embedded SQLite write-ahead log for crash recovery.
 *
 * Critical state changes (inventory mutations, gold, exp, level-up) are appended
 * here synchronously BEFORE the success packet is sent to the client. If the
 * world server crashes, {@link JournalReplayer} replays unprocessed entries into
 * the main Knex DB before the TCP listener reopens — preventing item dupes and
 * gold rollbacks.
 *
 * This class is persistence-only: it holds no game logic. Dispatch of replayed
 * events lives in the world-server (`systems/journalReplayer.ts`).
 *
 * Conforms to `.claude/rules/04-persistence.md`:
 * - `journal_mode = WAL` + `synchronous = NORMAL` for sub-0.1ms local writes.
 * - Rows are flagged `replayed = 1` (never deleted) so the journal doubles as
 *   an audit trail. `clearAll()` exists for tests / explicit reset only.
 *
 * @module database/journal
 */

/** A pending critical-state mutation awaiting main-DB flush. */
export interface JournalEntry {
  /** Character the event affects. */
  readonly charId: number;
  /** Discriminator used by the replayer registry (e.g. `ITEM_ADD`, `GOLD_CHANGE`). */
  readonly type: string;
  /** Arbitrary JSON-serialisable context — must contain enough to replay without the main DB. */
  readonly payload: unknown;
}

/** Raw journal row as read back from SQLite. */
export interface JournalRow {
  readonly id: number;
  readonly char_id: number;
  readonly event_type: string;
  readonly payload: string;
  readonly created_at: number;
  readonly replayed: number;
}

export interface JournalDeps {
  /** File path, or `:memory:` for tests. Parent directory is created if missing. */
  readonly path: string;
  readonly logger?: JournalLogger;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS pending_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    char_id     INTEGER NOT NULL,
    event_type  TEXT    NOT NULL,
    payload     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    replayed    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_pending_events_replayed
    ON pending_events (replayed);
`;

/**
 * Opens (or creates) the WAL journal. Call {@link close} on shutdown.
 *
 * @throws Error if SQLite cannot open the file (permissions, disk full).
 */
export class Journal {
  private readonly db: BetterSqlite3Database;
  private readonly logger: JournalLogger | undefined;
  private readonly stmtInsert: Statement;
  private readonly stmtUnreplayed: Statement;
  private readonly stmtMark: Statement;

  constructor(deps: JournalDeps) {
    if (deps.path !== ':memory:') {
      mkdirSync(dirname(deps.path), { recursive: true });
    }
    this.db = new Database(deps.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA_SQL);

    this.stmtInsert = this.db.prepare(
      'INSERT INTO pending_events (char_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)'
    );
    this.stmtUnreplayed = this.db.prepare(
      'SELECT id, char_id, event_type, payload, created_at, replayed FROM pending_events WHERE replayed = 0 ORDER BY id ASC'
    );
    this.stmtMark = this.db.prepare(
      'UPDATE pending_events SET replayed = 1 WHERE id = ?'
    );
    this.logger = deps.logger;
  }

  /**
   * Append a critical-state event synchronously.
   *
   * MUST be called BEFORE the success response is sent to the client so a crash
   * between this call and the main-DB flush loses no data (rule `04-persistence.md`).
   *
   * @returns the auto-incremented row id (useful for tests / correlation).
   */
  append(entry: JournalEntry, createdAt: number = Date.now()): number {
    const info = this.stmtInsert.run(
      entry.charId,
      entry.type,
      JSON.stringify(entry.payload),
      createdAt
    );
    return Number(info.lastInsertRowid);
  }

  /**
   * Returns every unprocessed event in insertion order. Replayer iterates this,
   * applies each to the main DB, then calls {@link markReplayed}.
   */
  getUnreplayed(): JournalRow[] {
    return this.stmtUnreplayed.all() as JournalRow[];
  }

  /**
   * Flag a row as safely flushed to the main DB. Idempotent.
   */
  markReplayed(id: number): void {
    this.stmtMark.run(id);
  }

  /**
   * Wipe the journal. Tests / explicit operator reset only — never call this on
   * a production server unless you accept the data-loss window before the next
   * main-DB flush.
   */
  clearAll(): void {
    this.db.exec('DELETE FROM pending_events');
  }

  /** Total rows (replayed + unreplayed). Diagnostic for boot logging. */
  countUnreplayed(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM pending_events WHERE replayed = 0'
    ).get() as { n: number };
    return row.n;
  }

  /** Close the SQLite handle. Safe to call once on shutdown. */
  close(): void {
    try {
      this.db.close();
    } catch (err) {
      this.logger?.warn({ err }, 'Journal close failed');
    }
  }
}
