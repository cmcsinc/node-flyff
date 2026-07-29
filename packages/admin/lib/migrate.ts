/**
 * Lightweight migration runner for the admin panel.
 *
 * The game server applies migrations via Knex in `login-server/seed.ts`. The
 * admin shares the same SQLite file but uses Drizzle + raw better-sqlite3, so
 * it cannot call the Knex `up()` functions directly. Instead this module runs
 * the equivalent ALTER TABLE / CREATE TABLE statements as raw SQL, gated by
 * `PRAGMA table_info` / `sqlite_master` existence checks — the same pattern
 * seed.ts uses but without Knex.
 *
 * Keep this list in sync with `login-server/src/seed.ts` MIGRATIONS.
 *
 * @module admin/lib/migrate
 */

import type * as Database from 'better-sqlite3';

interface Migration {
  /** GATE: `hasColumn(table, col)` — ALTER TABLE migrations. */
  readonly column?: readonly [string, string];
  /** GATE: `hasTable(name)` — CREATE TABLE migrations. */
  readonly table?: string;
  readonly sql: string[];
}

const MIGRATIONS: readonly Migration[] = [
  // 001 — initial tables
  { table: 'accounts', sql: [
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      gm INTEGER DEFAULT 0,
      banned INTEGER DEFAULT 0,
      banned_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL UNIQUE,
      slot INTEGER NOT NULL,
      class INTEGER DEFAULT 0,
      gender INTEGER DEFAULT 0,
      hair_style INTEGER DEFAULT 1,
      hair_color INTEGER DEFAULT 1,
      face_style INTEGER DEFAULT 1,
      skin_color INTEGER DEFAULT 1,
      level INTEGER DEFAULT 1,
      exp TEXT DEFAULT '0',
      hp INTEGER DEFAULT 100,
      mp INTEGER DEFAULT 50,
      max_hp INTEGER DEFAULT 100,
      max_mp INTEGER DEFAULT 50,
      strength INTEGER DEFAULT 15,
      stamina INTEGER DEFAULT 15,
      dexterity INTEGER DEFAULT 15,
      intelligence INTEGER DEFAULT 15,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      z REAL DEFAULT 0,
      world_id TEXT DEFAULT 'world1',
      zone_id INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, slot)
    )`,
    `CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      flags INTEGER DEFAULT 0,
      durability INTEGER DEFAULT -1,
      refine INTEGER DEFAULT 0,
      stats TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, slot)
    )`,
    `CREATE TABLE IF NOT EXISTS bank (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      flags INTEGER DEFAULT 0,
      durability INTEGER DEFAULT -1,
      refine INTEGER DEFAULT 0,
      stats TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, slot)
    )`,
    `CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      skill_id INTEGER NOT NULL,
      level INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, skill_id)
    )`,
    `CREATE TABLE IF NOT EXISTS quick_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      type INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, slot)
    )`,
  ]},
  // 002 — quest tables
  { table: 'character_quests', sql: [
    `CREATE TABLE IF NOT EXISTS character_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      quest_id INTEGER NOT NULL,
      state INTEGER DEFAULT 0,
      time INTEGER DEFAULT 0,
      kill_npc_num_0 INTEGER DEFAULT 0,
      kill_npc_num_1 INTEGER DEFAULT 0,
      flags INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, quest_id)
    )`,
    `CREATE TABLE IF NOT EXISTS character_completed_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      quest_id INTEGER NOT NULL,
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS character_checked_quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      quest_id INTEGER NOT NULL,
      slot INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS quest_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      quest_id INTEGER NOT NULL,
      action INTEGER NOT NULL,
      ts TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
  ]},
  // 003 — characters.gold
  { column: ['characters', 'gold'], sql: [
    `ALTER TABLE characters ADD COLUMN gold TEXT NOT NULL DEFAULT '0'`,
  ]},
  // 004 — bank.tab + accounts.bank_gold
  { column: ['bank', 'tab'], sql: [
    `ALTER TABLE bank ADD COLUMN tab INTEGER NOT NULL DEFAULT 0`,
  ]},
  { column: ['accounts', 'bank_gold'], sql: [
    `ALTER TABLE accounts ADD COLUMN bank_gold TEXT NOT NULL DEFAULT '0'`,
  ]},
  // 005 — skills.slot + characters.skill_point/skill_level
  { column: ['skills', 'slot'], sql: [
    `ALTER TABLE skills ADD COLUMN slot INTEGER NOT NULL DEFAULT 0`,
  ]},
  { column: ['characters', 'skill_point'], sql: [
    `ALTER TABLE characters ADD COLUMN skill_point INTEGER NOT NULL DEFAULT 0`,
  ]},
  { column: ['characters', 'skill_level'], sql: [
    `ALTER TABLE characters ADD COLUMN skill_level INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 006 — characters.bank_pass
  { column: ['characters', 'bank_pass'], sql: [
    `ALTER TABLE characters ADD COLUMN bank_pass TEXT NOT NULL DEFAULT '0000'`,
  ]},
  // 007 — characters.angle
  { column: ['characters', 'angle'], sql: [
    `ALTER TABLE characters ADD COLUMN angle REAL NOT NULL DEFAULT 0`,
  ]},
  // 008 — normalize containers (inventory + bank tables)
  { column: ['inventory', 'gold'], sql: [
    `CREATE TABLE IF NOT EXISTS inventory (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      gold TEXT NOT NULL DEFAULT '0',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      flags INTEGER DEFAULT 0,
      durability INTEGER DEFAULT -1,
      refine INTEGER DEFAULT 0,
      stats TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(character_id, slot)
    )`,
    `CREATE TABLE IF NOT EXISTS bank (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      gold TEXT NOT NULL DEFAULT '0',
      bank_pass TEXT NOT NULL DEFAULT '0000',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS bank_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      tab INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      flags INTEGER DEFAULT 0,
      durability INTEGER DEFAULT -1,
      refine INTEGER DEFAULT 0,
      stats TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, tab, slot)
    )`,
  ]},
  // 009 — characters.taskbar
  { column: ['characters', 'taskbar'], sql: [
    `ALTER TABLE characters ADD COLUMN taskbar TEXT`,
  ]},
  // 010 — characters.remain_gp
  { column: ['characters', 'remain_gp'], sql: [
    `ALTER TABLE characters ADD COLUMN remain_gp INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 011 — bank gold_tab1 / gold_tab2
  { column: ['bank', 'gold_tab1'], sql: [
    `ALTER TABLE bank ADD COLUMN gold_tab1 TEXT NOT NULL DEFAULT '0'`,
  ]},
  { column: ['bank', 'gold_tab2'], sql: [
    `ALTER TABLE bank ADD COLUMN gold_tab2 TEXT NOT NULL DEFAULT '0'`,
  ]},
  // 012 — inventory_item element / element_level
  { column: ['inventory_item', 'element'], sql: [
    `ALTER TABLE inventory_item ADD COLUMN element INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE inventory_item ADD COLUMN element_level INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 013 — characters PK state
  { column: ['characters', 'pk_propensity'], sql: [
    `ALTER TABLE characters ADD COLUMN pk_propensity INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE characters ADD COLUMN pk_value INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE characters ADD COLUMN pk_time INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE characters ADD COLUMN pk_exp INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 014 — characters.buffs (superseded by 015 — kept for forward-compat on old DBs)
  { column: ['characters', 'buffs'], sql: [
    `ALTER TABLE characters ADD COLUMN buffs TEXT`,
  ]},
  // 015 — normalize buffs: character_buffs table, drop characters.buffs column
  { table: 'character_buffs', sql: [
    `CREATE TABLE IF NOT EXISTS character_buffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      type INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL DEFAULT 0,
      UNIQUE(character_id, type, skill_id)
    )`,
  ]},
  // 016 — buff timer: persist absolute deadline instead of total duration
  { column: ['character_buffs', 'expires_at_ms'], sql: [
    `ALTER TABLE character_buffs ADD COLUMN expires_at_ms INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 017 — presence + mail (mirrors database/src/migrations/017_presence_and_mail.ts)
  { table: 'online_players', sql: [
    `CREATE TABLE IF NOT EXISTS online_players (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      world_id TEXT NOT NULL,
      zone_id INTEGER NOT NULL,
      server_id TEXT NOT NULL,
      last_seen_ms INTEGER NOT NULL
    )`,
  ]},
  { table: 'mail', sql: [
    `CREATE TABLE IF NOT EXISTS mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receiver_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL DEFAULT 0,
      sender_name TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      gold TEXT NOT NULL DEFAULT '0',
      item_id INTEGER,
      item_count INTEGER NOT NULL DEFAULT 0,
      item_flags INTEGER NOT NULL DEFAULT 0,
      item_refine INTEGER NOT NULL DEFAULT 0,
      item_element INTEGER NOT NULL DEFAULT 0,
      item_element_level INTEGER NOT NULL DEFAULT 0,
      item_durability INTEGER NOT NULL DEFAULT -1,
      read INTEGER NOT NULL DEFAULT 0,
      taken_item INTEGER NOT NULL DEFAULT 0,
      taken_gold INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS mail_receiver_idx ON mail(receiver_id)`,
  ]},
  // Admin-only: GM action trail. No game-server counterpart — the admin panel
  // owns this table, so it is not mirrored in login-server/seed.ts.
  { table: 'admin_audit_log', sql: [
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
  ]},
] as const;

function hasTable(db: Database.Database, name: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
  ).get(name) as { name: string } | undefined;
  return row !== undefined;
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  // PRAGMA table_info is safe even for non-existent tables (returns empty).
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === col);
}

/**
 * Apply all pending game-server migrations to the given SQLite database.
 *
 * Idempotent — each migration is gated by a table/column existence check.
 * Safe to call on every startup.
 *
 * @param sqlite - raw better-sqlite3 instance
 */
export function runMigrations(sqlite: Database.Database): void {
  for (const m of MIGRATIONS) {
    const done = m.column
      ? hasColumn(sqlite, m.column[0], m.column[1])
      : hasTable(sqlite, m.table!);
    if (done) continue;

    const label = m.column
      ? `${m.column[0]}.${m.column[1]}`
      : m.table!;
    console.log(`[admin/migrate] ${label} missing — applying migration`);
    for (const stmt of m.sql) {
      sqlite.exec(stmt);
    }
  }
}
