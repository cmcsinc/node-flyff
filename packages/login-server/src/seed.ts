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
import { up as migrationUp } from '@flyff/database/migrations/001_initial';
import { hashPassword } from '@flyff/core/utils/password.js';

const DB_FILENAME = process.env['DB_FILENAME'] ?? './data/flyff_dev.sqlite3';
const SALT = 'kikugalanet';
const ACCOUNT = 'test';
const PASSWORD = 'test';

async function main(): Promise<void> {
  if (DB_FILENAME !== ':memory:') mkdirSync(dirname(DB_FILENAME), { recursive: true });
  const db = createDb({ client: 'better-sqlite3', connection: DB_FILENAME });
  try {
    if (!(await db.schema.hasTable('accounts'))) {
      console.log('[seed] accounts table missing — running migration up()');
      await migrationUp(db);
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
        x: 0, y: 0, z: 0, world_id: 'W1', zone_id: 1,
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
