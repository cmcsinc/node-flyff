import type Database from 'better-sqlite3';
import type { BetterSQLite3Database, drizzle as DrizzleFunction } from 'drizzle-orm/better-sqlite3';
import type * as NodePath from 'node:path';
import type { fileURLToPath as FileURLToPath } from 'node:url';
import type { runMigrations as RunMigrations } from './migrate';
import * as schema from '@/../drizzle/schema';

declare function require(id: 'better-sqlite3'): typeof Database;
declare function require(id: 'drizzle-orm/better-sqlite3'): { drizzle: typeof DrizzleFunction };
declare function require(id: './migrate'): { runMigrations: typeof RunMigrations };
declare function require(id: 'node:path'): typeof NodePath;
declare function require(id: 'node:url'): { fileURLToPath: typeof FileURLToPath };

// Lazy singleton — only instantiated on first access, not at import time.
// This prevents better-sqlite3 native bindings from loading during build
// for pages that don't need the database (e.g. resource browsers).
//
// IMPORTANT: nothing in this module's top level may touch Node-only APIs
// (process.cwd, fs, etc.). The middleware imports auth.ts which imports
// this file, so this module is evaluated in the Edge Runtime, where those
// APIs are unavailable. All Node-only work is deferred into getDb().
let _db: BetterSQLite3Database<typeof schema> | null = null;

let _Database: typeof Database | null = null;
let _drizzle: typeof DrizzleFunction | null = null;
let _runMigrations: typeof RunMigrations | null = null;

function ensureImports(): void {
  if (!_Database) {
    _Database = require('better-sqlite3');
    _drizzle = require('drizzle-orm/better-sqlite3').drizzle;
    _runMigrations = require('./migrate').runMigrations;
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
    const { fileURLToPath } = require('node:url');
    const path = require('node:path');
    _repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  }
  return _repoRoot;
}

function resolveDbPath(): string {
  const path = require('node:path');
  const raw = process.env.DB_FILENAME ?? './data/flyff_dev.sqlite3';
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(getRepoRoot(), raw);
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) {
    ensureImports();
    if (!_Database || !_drizzle || !_runMigrations) {
      throw new TypeError('Database modules failed to load');
    }
    const sqlite = new _Database(resolveDbPath());
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    // Apply any pending game-server migrations so the admin never hits a
    // missing column/table when the game server hasn't run seed yet.
    _runMigrations(sqlite);
    _db = _drizzle(sqlite, { schema });
  }
  return _db;
}

// Backwards-compatible export (lazy via Proxy)
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(_target, prop): unknown {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value: unknown = real[prop as PropertyKey];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

export type DrizzleDb = BetterSQLite3Database<typeof schema>;
