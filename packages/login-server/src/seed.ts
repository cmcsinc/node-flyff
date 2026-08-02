/**
 * Seed a dev account + character so a real v19 client can log in.
 *
 * Password handling matches the v19 client (`Neuz/Neuz.cpp:1147`): the client
 * sends `md5("kikugalanet" + typed)` Rijndael-encrypted; our certifier decrypts
 * that to the md5hex, then argon2-verifies. So the stored hash must be
 * `argon2(md5("kikugalanet" + typed))`.
 *
 *   account:  test
 *   password: test
 *
 * Idempotent: re-running skips an existing account.
 *
 * @module login-server/seed
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDb, AccountRepository, CharacterRepository } from '@flyff/database';
import { up as migrationUp001 } from '@flyff/database/migrations/001_initial';
import { up as migrationUp002 } from '@flyff/database/migrations/002_quests';
import { up as migrationUp003 } from '@flyff/database/migrations/003_character_gold';
import { up as migrationUp004 } from '@flyff/database/migrations/004_bank_tab';
import { up as migrationUp005 } from '@flyff/database/migrations/005_skills_slot';
import { up as migrationUp006 } from '@flyff/database/migrations/006_bank_pass';
import { up as migrationUp007 } from '@flyff/database/migrations/007_character_angle';
import { up as migrationUp008 } from '@flyff/database/migrations/008_normalize_containers';
import { up as migrationUp009 } from '@flyff/database/migrations/009_taskbar';
import { up as migrationUp010 } from '@flyff/database/migrations/010_character_remain_gp';
import { up as migrationUp011 } from '@flyff/database/migrations/011_bank_per_tab_gold';
import { up as migrationUp012 } from '@flyff/database/migrations/012_item_element';
import { up as migrationUp013 } from '@flyff/database/migrations/013_pk_state';
import { up as migrationUp014 } from '@flyff/database/migrations/014_character_buffs';
import { up as migrationUp015 } from '@flyff/database/migrations/015_normalize_buffs';
import { up as migrationUp016 } from '@flyff/database/migrations/016_buff_expires_at';
import { up as migrationUp017 } from '@flyff/database/migrations/017_presence_and_mail';
import { up as migrationUp018 } from '@flyff/database/migrations/018_drop_buff_total_ms';
import { up as migrationUp019 } from '@flyff/database/migrations/019_friends';
import { up as migrationUp020 } from '@flyff/database/migrations/020_campus';
import { up as migrationUp021 } from '@flyff/database/migrations/021_account_authority';
import { hashPassword } from '@flyff/core/utils/password';

/**
 * Ordered migration list -- each `up()` is gated so re-running seed is
 * idempotent and brings an existing dev DB up to head. Without this, a new
 * migration file is never applied to the dev DB and the first query against it
 * throws SQLITE_ERROR at runtime (missing column/table).
 *
 * `marker` gates on `hasTable`; `column: [table, col]` gates on `hasColumn`
 * for ALTER migrations that don't create a table.
 */
const MIGRATIONS = [
  { marker: 'accounts', up: migrationUp001 },
  { marker: 'character_quests', up: migrationUp002 },
  { column: ['characters', 'gold'], up: migrationUp003 },
  { column: ['bank', 'tab'], up: migrationUp004 },
  { column: ['skills', 'slot'], up: migrationUp005 },
  { column: ['characters', 'bank_pass'], up: migrationUp006 },
  { column: ['characters', 'angle'], up: migrationUp007 },
  { column: ['inventory', 'gold'], up: migrationUp008 },
  { column: ['characters', 'taskbar'], up: migrationUp009 },
  { column: ['characters', 'remain_gp'], up: migrationUp010 },
  { column: ['bank', 'gold_tab1'], up: migrationUp011 },
  { column: ['inventory_item', 'element'], up: migrationUp012 },
  { column: ['characters', 'pk_propensity'], up: migrationUp013 },
  { column: ['characters', 'buffs'], up: migrationUp014 },
  { marker: 'character_buffs', up: migrationUp015 },
  { column: ['character_buffs', 'expires_at_ms'], up: migrationUp016 },
  { marker: 'mail', up: migrationUp017 },
  { dropColumn: ['character_buffs', 'total_ms'], up: migrationUp018 },
  { marker: 'friends', up: migrationUp019 },
  { marker: 'campus', up: migrationUp020 },
  { column: ['accounts', 'authority'], up: migrationUp021 },
] as const;

const DB_FILENAME = process.env['DB_FILENAME'] ?? './data/flyff_dev.sqlite3';
const SALT = 'kikugalanet';
const ACCOUNT = 'test';
const PASSWORD = 'test';

async function main(): Promise<void> {
  if (DB_FILENAME !== ':memory:') mkdirSync(dirname(DB_FILENAME), { recursive: true });
  const db = createDb({ client: 'better-sqlite3', connection: DB_FILENAME });
  try {
    for (const m of MIGRATIONS) {
      const done = 'dropColumn' in m
        ? !(await db.schema.hasColumn(m.dropColumn[0], m.dropColumn[1]))
        : 'column' in m
          ? await db.schema.hasColumn(m.column[0], m.column[1])
          : await db.schema.hasTable(m.marker);
      if (done) continue;
      const label = 'dropColumn' in m
        ? `${m.dropColumn[0]}.${m.dropColumn[1]} (drop)`
        : 'column' in m ? `${m.column[0]}.${m.column[1]}` : m.marker;
      console.log(`[seed] ${label} missing -- running migration up()`);
      await m.up(db);
    }
    const accountRepo = new AccountRepository(db);
    const charRepo = new CharacterRepository(db);

    const existing = await accountRepo.findByUsername(ACCOUNT);
    let accountId: number;
    if (existing) {
      accountId = existing.id;
      console.log(`[seed] account "${ACCOUNT}" already exists (id=${accountId}) -- leaving as-is`);
    } else {
      const md5hex = createHash('md5').update(SALT + PASSWORD).digest('hex');
      const passwordHash = await hashPassword(md5hex);
      accountId = await accountRepo.create({
        username: ACCOUNT, password_hash: passwordHash, email: `${ACCOUNT}@local`,
        authority: 0x50, banned: false, banned_until: null, // AUTH_ADMINISTRATOR -- testable admin
      });
      console.log(`[seed] created account "${ACCOUNT}" (id=${accountId}) password "${PASSWORD}"`);
    }

    const chars = await charRepo.findByAccountId(accountId);
    if (chars.length === 0) {
      await charRepo.create({
        account_id: accountId, name: 'Tester', slot: 0, class: 1, gender: 0,
        hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
        exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
        strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
        x: 6971.98, y: 100.0, z: 3336.88, world_id: 'W1', zone_id: 1, // Flaris RI_BEGIN (WdMadrigal.rgn:742)
      });
      console.log(`[seed] created character "Tester" for account ${accountId}`);
    } else {
      console.log(`[seed] account ${accountId} already has ${chars.length} character(s) -- skipping`);
    }
  } finally {
    await db.destroy();
  }
}

void main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
