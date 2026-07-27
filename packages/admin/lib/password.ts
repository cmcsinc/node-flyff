/**
 * Admin password verification — mirrors the login-server exactly so a single
 * account row works for both the game client and the admin panel.
 *
 * Stored hash = KDF( md5( "kikugalanet" + typedPassword ) ), matching
 * `packages/login-server/src/seed.ts:90` and the v19 client convention
 * (Neuz sends md5("kikugalanet"+pwd); see `seed.ts:5`).
 *
 * KDF support matches `@flyff/core/utils/password`:
 *   - argon2id  ("$argon2id$...")  when the native argon2 binding is installed
 *   - scrypt    ("$scrypt$N$r$p$saltB64$keyB64")  the deterministic fallback
 *
 * This module is imported only by lib/auth.ts and used inside `authorize()`,
 * which runs in the Node.js runtime (route handler) — not the Edge Runtime.
 * All node:crypto calls are deferred to function-call time, never at import.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** v19 client password salt — must match the login-server seed. */
const V19_SALT = "kikugalanet";

/** scrypt KDF params (N=2^14, r=8, p=1, 32-byte key) — OWASP-recommended. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** scrypt key length (bytes) — matches @flyff/core/utils/password. */
const SCRYPT_KEYLEN = 32;

/** Derive the md5 digest the client/server hash: md5(salt + password) hex. */
function md5Digest(password: string): string {
  return createHash("md5").update(V19_SALT + password).digest("hex");
}

/** Verify an scrypt PHC-ish hash ("$scrypt$N$r$p$saltB64$keyB64"). */
function verifyScrypt(hash: string, password: string): boolean {
  const parts = hash.split("$");
  if (parts.length !== 7 || parts[1] !== "scrypt") return false;
  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  const saltStr = parts[5];
  const keyStr = parts[6];
  if (!saltStr || !keyStr) return false;
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltStr, "base64");
  const expected = Buffer.from(keyStr, "base64");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const key = scryptSync(password, salt, expected.length, { N, r, p });
  return timingSafeEqual(key, expected);
}

/**
 * Verify an argon2 hash via the optional native binding (no-op if absent).
 *
 * The `require("argon2")` is wrapped in `eval` to defeat webpack's static
 * analysis in the Edge/middleware bundle. Without this, webpack resolves
 * `argon2.cjs` (which itself imports `node:crypto`) and fails with
 * UnhandledSchemeError even though this path is never called at runtime in
 * middleware — it's only reached by route handlers (Node runtime).
 */
async function verifyArgon2(hash: string, password: string): Promise<boolean> {
  try {
    // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
    const mod = (0, eval)("require")("argon2") as {
      verify: (h: string, p: string) => Promise<boolean>;
    };
    return await mod.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Verify a plaintext password against a stored hash, applying the v19 md5
 * derivation first. Returns true on match, false otherwise (never throws).
 */
export async function verifyAccountPassword(
  plaintext: string,
  storedHash: string,
): Promise<boolean> {
  const digest = md5Digest(plaintext);
  if (storedHash.startsWith("$scrypt$")) return verifyScrypt(storedHash, digest);
  if (storedHash.startsWith("$argon2")) return verifyArgon2(storedHash, digest);
  return false;
}

/**
 * Hash a plaintext password for storage, applying the v19 md5 derivation and
 * the deterministic scrypt KDF (the dev-DB format; matches
 * @flyff/core/utils/password's fallback so the login-server can verify the
 * same row). Used by the admin seed script to mint GM accounts.
 */
export function hashAccountPassword(plaintext: string): string {
  const digest = md5Digest(plaintext);
  const salt = randomBytes(16);
  const key = scryptSync(digest, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
