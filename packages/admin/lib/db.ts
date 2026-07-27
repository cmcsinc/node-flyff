import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/../drizzle/schema";

const DB_PATH = process.env.DB_FILENAME || "./dev.sqlite3";

// Lazy singleton — only instantiated on first access, not at import time.
// This prevents better-sqlite3 native bindings from loading during build
// for pages that don't need the database (e.g. resource browsers).
let _db: BetterSQLite3Database<typeof schema> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Database: any = null;
let _drizzle: any = null;

function ensureImports() {
  if (!_Database) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Database = require("better-sqlite3");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _drizzle = require("drizzle-orm/better-sqlite3").drizzle;
  }
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    ensureImports();
    const sqlite = new _Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = _drizzle(sqlite, { schema });
  }
  return _db!;
}

// Backwards-compatible export (lazy via Proxy)
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type DrizzleDb = BetterSQLite3Database<typeof schema>;
