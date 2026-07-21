/**
 * Seed a dev account + character so a real v15 client can log in.
 *
 * Password handling matches the v15 client (`Neuz/Neuz.cpp:1147`): the client
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
import { hashPassword } from '@flyff/core/utils/password.js';

/**
 * Ordered migration list — each `up()` is gated on its own marker table so
 * re-running seed is idempotent and brings an existing dev DB up to head.
 * Without this, a new migration file (e.g. 002_quests) is never applied to the
 * dev DB and the first query against it throws SQLITE_ERROR at runtime (JOIN).
 */
const MIGRATIONS = [
  { marker: 'accounts', up: migrationUp001 },
  { marker: 'character_quests', up: migrationUp002 },
];

const DB_FILENAME = process.env['DB_FILENAME'] ?? './data/flyff_dev.sqlite3';
const SALT = 'kikugalanet';
const ACCOUNT = 'test';
const PASSWORD = 'test';

async function main(): Promise<void> {
  if (DB_FILENAME !== ':memory:') mkdirSync(dirname(DB_FILENAME), { recursive: true });
  const db = createDb({ client: 'better-sqlite3', connection: DB_FILENAME });
  try {
    for (const { marker, up } of MIGRATIONS) {
      if (await db.schema.hasTable(marker)) continue;
      console.log(`[seed] ${marker} missing — running migration up()`);
      await up(db);
    }
    const accountRepo = new AccountRepository(db);
    const charRepo = new CharacterRepository(db);

    const existing = await accountRepo.findByUsername(ACCOUNT);
    let accountId: number;
    if (existing) {
      accountId = existing.id;
      console.log(`[seed] account "${ACCOUNT}" already exists (id=${accountId}) — leaving as-is`);
    } else {
      const md5hex = createHash('md5').update(SALT + PASSWORD).digest('hex');
      const passwordHash = await hashPassword(md5hex);
      accountId = await accountRepo.create({
        username: ACCOUNT, password_hash: passwordHash, email: `${ACCOUNT}@local`,
        gm: false, banned: false, banned_until: null,
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
      console.log(`[seed] account ${accountId} already has ${chars.length} character(s) — skipping`);
    }
  } finally {
    await db.destroy();
  }
}

void main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
