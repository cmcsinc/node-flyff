import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/../drizzle/schema";

// Lazy singleton — only instantiated on first access, not at import time.
// This prevents better-sqlite3 native bindings from loading during build
// for pages that don't need the database (e.g. resource browsers).
//
// IMPORTANT: nothing in this module's top level may touch Node-only APIs
// (process.cwd, fs, etc.). The middleware imports auth.ts which imports
// this file, so this module is evaluated in the Edge Runtime, where those
// APIs are unavailable. All Node-only work is deferred into getDb().
let _db: BetterSQLite3Database<typeof schema> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Database: any = null;
let _drizzle: any = null;
let _runMigrations: ((sqlite: unknown) => void) | null = null;

function ensureImports() {
  if (!_Database) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Database = require("better-sqlite3");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _drizzle = require("drizzle-orm/better-sqlite3").drizzle;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _runMigrations = require("./migrate").runMigrations;
  }
}

/**
 * Resolve the SQLite path against the monorepo root. The shared root .env
 * defines `DB_FILENAME` as a repo-root-relative path (e.g. ./data/flyff_dev.
 * sqlite3). We derive the repo root from this file's own location via
 * import.meta.url so the path is correct regardless of whether the process
 * cwd is packages/admin or the repo root (start-admin.mjs sets cwd=ROOT).
 *
 * Computed lazily inside getDb() — never at module import time — because
 * this module is evaluated in Edge Runtime via the auth middleware, where
 * Node-only APIs like fileURLToPath may not be available.
 */
let _repoRoot: string | null = null;

function getRepoRoot(): string {
  if (!_repoRoot) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fileURLToPath } = require("url");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    _repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  }
  return _repoRoot;
}

function resolveDbPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  const raw = process.env.DB_FILENAME || "./data/flyff_dev.sqlite3";
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(getRepoRoot(), raw);
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    ensureImports();
    const sqlite = new _Database(resolveDbPath());
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // Apply any pending game-server migrations so the admin never hits a
    // missing column/table when the game server hasn't run seed yet.
    _runMigrations!(sqlite);
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
