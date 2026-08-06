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
  /** GATE (inverted): done when the column is ABSENT — DROP COLUMN migrations. */
  readonly dropColumn?: readonly [string, string];
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
  // 016b — drop the superseded total_ms. DBs created before 016 kept it NOT NULL
  // with no default, so every insert from the new (expires_at_ms-only) write path
  // fails with SQLITE_CONSTRAINT_NOTNULL.
  { dropColumn: ['character_buffs', 'total_ms'], sql: [
    `ALTER TABLE character_buffs DROP COLUMN total_ms`,
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
  // 019 — friends roster (mirrors database/src/migrations/019_friends.ts)
  { table: 'friends', sql: [
    `CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      friend_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      UNIQUE(character_id, friend_id)
    )`,
    `CREATE INDEX IF NOT EXISTS friends_character_idx ON friends(character_id)`,
  ]},
  { column: ['characters', 'messenger_state'], sql: [
    `ALTER TABLE characters ADD COLUMN messenger_state INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 020 — campus (master/pupil) — mirrors 020_campus.ts
  { table: 'campus', sql: [
    `CREATE TABLE IF NOT EXISTS campus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      master_id INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS campus_master_idx ON campus(master_id)`,
    `CREATE TABLE IF NOT EXISTS campus_member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campus_id INTEGER NOT NULL REFERENCES campus(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      member_level INTEGER NOT NULL,
      joined_at_ms INTEGER NOT NULL,
      UNIQUE(character_id)
    )`,
    `CREATE INDEX IF NOT EXISTS campus_member_campus_idx ON campus_member(campus_id)`,
  ]},
  { column: ['characters', 'campus_point'], sql: [
    `ALTER TABLE characters ADD COLUMN campus_point INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE characters ADD COLUMN campus_tick_ms INTEGER NOT NULL DEFAULT 0`,
  ]},
  // 021 — tiered authority replaces accounts.gm — mirrors 021_account_authority.ts.
  // authority holds the AUTH_* ASCII code (GENERAL 'F' 0x46 .. ADMINISTRATOR 'P' 0x50).
  // Backfill maps the old boolean (gm=1 -> ADMINISTRATOR) before dropping gm.
  { column: ['accounts', 'authority'], sql: [
    `ALTER TABLE accounts ADD COLUMN authority INTEGER NOT NULL DEFAULT 0x46`,
    `UPDATE accounts SET authority = 0x50 WHERE gm = 1`,
    `ALTER TABLE accounts DROP COLUMN gm`,
  ]},
  // 022 — durable parties — mirrors 022_parties.ts. Diverges from C++ on
  // purpose: vanilla keeps rosters in CoreServer RAM only.
  { table: 'parties', sql: [
    `CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY,
      kind_troup INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      point INTEGER NOT NULL DEFAULT 0,
      exp_mode INTEGER NOT NULL DEFAULT 0,
      item_mode INTEGER NOT NULL DEFAULT 0,
      last_item_getter_id INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS party_member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      joined_at_ms INTEGER NOT NULL,
      UNIQUE(character_id)
    )`,
    `CREATE INDEX IF NOT EXISTS party_member_party_idx ON party_member(party_id)`,
  ]},
  // 023 — guilds — mirrors 023_guild.ts. Ported from CGuild/CGuildMember
  // (guild.h:179-376). master_id is intentionally not an FK (C++ derives the
  // master from member_lv == GUD_MASTER; an FK would block character delete).
  { table: 'guild', sql: [
    `CREATE TABLE IF NOT EXISTS guild (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      master_id INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      logo INTEGER NOT NULL DEFAULT 0,
      contribution_pxp INTEGER NOT NULL DEFAULT 0,
      gold INTEGER NOT NULL DEFAULT 0,
      notice TEXT NOT NULL DEFAULT '',
      power_0 INTEGER NOT NULL DEFAULT 255,
      power_1 INTEGER NOT NULL DEFAULT 0,
      power_2 INTEGER NOT NULL DEFAULT 0,
      power_3 INTEGER NOT NULL DEFAULT 0,
      power_4 INTEGER NOT NULL DEFAULT 0,
      penya_0 INTEGER NOT NULL DEFAULT 0,
      penya_1 INTEGER NOT NULL DEFAULT 0,
      penya_2 INTEGER NOT NULL DEFAULT 0,
      penya_3 INTEGER NOT NULL DEFAULT 0,
      penya_4 INTEGER NOT NULL DEFAULT 0,
      win INTEGER NOT NULL DEFAULT 0,
      lose INTEGER NOT NULL DEFAULT 0,
      surrender INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      UNIQUE(name)
    )`,
    `CREATE TABLE IF NOT EXISTS guild_member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id INTEGER NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      member_lv INTEGER NOT NULL DEFAULT 4,
      class INTEGER NOT NULL DEFAULT 0,
      pay INTEGER NOT NULL DEFAULT 0,
      give_gold INTEGER NOT NULL DEFAULT 0,
      give_pxp INTEGER NOT NULL DEFAULT 0,
      win INTEGER NOT NULL DEFAULT 0,
      lose INTEGER NOT NULL DEFAULT 0,
      surrender INTEGER NOT NULL DEFAULT 0,
      alias TEXT NOT NULL DEFAULT '',
      selected_vote_id INTEGER NOT NULL DEFAULT 0,
      joined_at_ms INTEGER NOT NULL,
      UNIQUE(character_id)
    )`,
    `CREATE INDEX IF NOT EXISTS guild_member_guild_idx ON guild_member(guild_id)`,
    `CREATE TABLE IF NOT EXISTS guild_cooldown (
      character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      until_ms INTEGER NOT NULL
    )`,
  ]},
  // 024 — guild bank — mirrors 024_guild_bank.ts. Container/contents split per
  // rule 11: C++ packs all 42 slots (MAX_GUILDBANK, guild.h:30) into three
  // strings in one GUILD_BANK_STR row (DbManager.cpp:3515); that is a flat-file
  // optimization, not a schema. The bank's penya pool stays on guild.gold
  // (m_nGoldGuild is both the balance and the level-up currency).
  { table: 'guild_bank', sql: [
    `CREATE TABLE IF NOT EXISTS guild_bank (
      guild_id INTEGER PRIMARY KEY REFERENCES guild(id) ON DELETE CASCADE,
      updated_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS guild_bank_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id INTEGER NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      objid INTEGER,
      refine INTEGER NOT NULL DEFAULT 0,
      element INTEGER NOT NULL DEFAULT 0,
      element_level INTEGER NOT NULL DEFAULT 0,
      flags INTEGER NOT NULL DEFAULT 0,
      durability INTEGER NOT NULL DEFAULT -1,
      stats TEXT,
      deposited_by INTEGER,
      deposited_at_ms INTEGER NOT NULL,
      UNIQUE(guild_id, slot)
    )`,
    `CREATE INDEX IF NOT EXISTS guild_bank_item_guild_idx ON guild_bank_item(guild_id)`,
  ]},
  // 025 — guild war — mirrors 025_guild_war.ts. Two parts, so two entries: the
  // guild.win_point ALTER is column-gated, the guild_war table is table-gated.
  // m_nWinPoint (guild.h:288) is NOT in CGuild::Serialize — CoreServer-only
  // ranking state, which is why 023 missed it.
  { column: ['guild', 'win_point'], sql: [
    `ALTER TABLE guild ADD COLUMN win_point INTEGER NOT NULL DEFAULT 0`,
  ]},
  // Wars are durable in C++ too: CoreServer reloads GUILD_WAR_STR at boot and
  // re-derives both m_idEnemyGuild back-links. decl_/acpt_ flatten the two
  // WAR_ENTRY structs (guildwar.h:7-15). started_at_sec is SECONDS — it is the
  // 32-bit time_t that goes on the wire, not a ms timestamp.
  { table: 'guild_war', sql: [
    `CREATE TABLE IF NOT EXISTS guild_war (
      id INTEGER PRIMARY KEY,
      decl_guild_id INTEGER NOT NULL,
      decl_size INTEGER NOT NULL DEFAULT 0,
      decl_surrender INTEGER NOT NULL DEFAULT 0,
      decl_dead INTEGER NOT NULL DEFAULT 0,
      decl_absent INTEGER NOT NULL DEFAULT 0,
      acpt_guild_id INTEGER NOT NULL,
      acpt_size INTEGER NOT NULL DEFAULT 0,
      acpt_surrender INTEGER NOT NULL DEFAULT 0,
      acpt_dead INTEGER NOT NULL DEFAULT 0,
      acpt_absent INTEGER NOT NULL DEFAULT 0,
      flag INTEGER NOT NULL,
      started_at_sec INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS guild_war_decl_idx ON guild_war(decl_guild_id)`,
    `CREATE INDEX IF NOT EXISTS guild_war_acpt_idx ON guild_war(acpt_guild_id)`,
  ]},
  // 026 — guild quest — mirrors 026_guild_quest.ts. One row per (guild, quest);
  // GUILDQUEST (guildquest.h:40-53) is a flat m_aQuest[256] blit in C++, which is
  // an array layout for the DB wire, not a schema. quest_id stays SIGNED to match
  // the wire type (-1 is the C++ in-place tombstone), though no tombstone row is
  // ever stored — an absent row IS the tombstone. UNIQUE is the upsert's conflict
  // target, unlike guild_war's plain indexes. FK CASCADE here (guild_war has
  // none): a disbanded guild's quest rows unwind no live state.
  { table: 'guild_quest', sql: [
    `CREATE TABLE IF NOT EXISTS guild_quest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id INTEGER NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
      quest_id INTEGER NOT NULL,
      state INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS guild_quest_guild_quest_uniq ON guild_quest(guild_id, quest_id)`,
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
    const done = m.dropColumn
      ? !hasColumn(sqlite, m.dropColumn[0], m.dropColumn[1])
      : m.column
        ? hasColumn(sqlite, m.column[0], m.column[1])
        : hasTable(sqlite, m.table!);
    if (done) continue;

    const label = m.dropColumn
      ? `${m.dropColumn[0]}.${m.dropColumn[1]} (drop)`
      : m.column
        ? `${m.column[0]}.${m.column[1]}`
        : m.table!;
    console.log(`[admin/migrate] ${label} missing — applying migration`);
    for (const stmt of m.sql) {
      sqlite.exec(stmt);
    }
  }
}
