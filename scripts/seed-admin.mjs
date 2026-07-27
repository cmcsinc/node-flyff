#!/usr/bin/env node
/**
 * Admin seed — ensures at least one GM account exists for the admin panel.
 *
 * - Promotes the dev `test` account to GM if it exists.
 * - Creates a dedicated `admin` account (password `admin`) if no GM exists.
 *
 * Re-runnable: idempotent (checks before creating/promoting).
 *
 * Usage: node scripts/seed-admin.mjs
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { createRequire } from "node:module";

const ROOT = resolve(import.meta.dirname, "..");
const ADMIN = resolve(ROOT, "packages", "admin");

// Same v19 derivation + scrypt KDF as packages/admin/lib/password.ts and
// the login-server seed — so the row verifies identically in both places.
const SALT = "kikugalanet";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

function hashPassword(plaintext) {
  const digest = createHash("md5").update(SALT + plaintext).digest("hex");
  const salt = randomBytes(16);
  const key = scryptSync(digest, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

// Resolve DB path — same logic as packages/admin/lib/db.ts.
const dbPathEnv = process.env.DB_FILENAME || "./data/flyff_dev.sqlite3";
const dbPath = dbPathEnv.startsWith("/") ? dbPathEnv : resolve(ROOT, dbPathEnv);

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}`);
  console.error("Run the login-server seed first, or set DB_FILENAME.");
  process.exit(1);
}

// Resolve better-sqlite3 from the admin package (pnpm does not hoist it to the
// repo root), so the script works regardless of where it's invoked from.
const adminRequire = createRequire(resolve(ADMIN, "package.json"));
const Database = adminRequire("better-sqlite3");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const now = new Date().toISOString().replace("T", " ").slice(0, 19);

// 1. Promote existing `test` account to GM if it exists.
const testRow = db.prepare("SELECT id, gm FROM accounts WHERE username = ?").get("test");
if (testRow) {
  if (!testRow.gm) {
    db.prepare("UPDATE accounts SET gm = 1, updated_at = ? WHERE id = ?").run(now, testRow.id);
    console.log("Promoted 'test' account to GM.");
  } else {
    console.log("'test' account is already GM. Skipped.");
  }
}

// 2. Create a dedicated `admin` account if no GM account exists.
const gmCount = db.prepare("SELECT COUNT(*) AS cnt FROM accounts WHERE gm = 1").get().cnt;
if (gmCount === 0) {
  const pwHash = hashPassword("admin");
  db.prepare(
    "INSERT INTO accounts (username, password_hash, email, gm, banned, created_at, updated_at) " +
      "VALUES (?, ?, ?, 1, 0, ?, ?)",
  ).run("admin", pwHash, "admin@localhost", now, now);
  console.log("Created 'admin' account with password 'admin' (GM = true).");
} else {
  console.log(`${gmCount} GM account(s) already exist. Skipped admin creation.`);
}

db.close();
console.log("Admin seed complete.");
