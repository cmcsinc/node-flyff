/**
 * Password hashing and verification.
 *
 * Primary: argon2id via the `argon2` npm package.
 * Fallback: a deterministic `scrypt` KDF from `node:crypto` (PHC-ish string),
 * used when the native argon2 binding is unavailable (e.g. Windows without
 * node-gyp). The fallback MUST be deterministic and embed its salt in the hash
 * string so a hash written by the seed process verifies inside the login
 * process -- a process-local Map does NOT work (seed and login are separate
 * processes, so the Map is empty on verify -> every login fails).
 *
 * Supports both plain passwords and MD5 digests from v15 clients: the server
 * stores argon2(md5) / scrypt(md5) so both flows work identically.
 *
 * ponytail: ceiling = ship argon2id in production (install the `argon2`
 * native binding via `pnpm install`). scrypt here is a dev/test fallback only.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

interface Argon2Exports {
  hash(password: string, options: {
    type: number;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  }): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

let argon2: Argon2Exports | null = null;

function getArgon2(): Argon2Exports {
  if (argon2) return argon2;

  try {
    // Dynamic require so the build does not depend on argon2 native bindings
    // when they are unavailable (e.g. Windows without node-gyp).
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const mod = require('argon2') as Argon2Exports;
    argon2 = mod;
    return mod;
  } catch {
    // Deterministic scrypt fallback -- see module doc.
    return scryptFallback;
  }
}

/** scrypt KDF params (N=2^14, r=8, p=1, 32-byte key) -- OWASP-recommended. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

const scryptFallback: Argon2Exports = {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    });
    return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
  },
  async verify(hash: string, password: string): Promise<boolean> {
    // `$scrypt$N$r$p$saltB64$keyB64` -> ['', 'scrypt', N, r, p, saltB64, keyB64]
    const parts = hash.split('$');
    if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
    const N = Number(parts[2]);
    const r = Number(parts[3]);
    const p = Number(parts[4]);
    const saltStr = parts[5];
    const keyStr = parts[6];
    if (!saltStr || !keyStr) return false;
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    const salt = Buffer.from(saltStr, 'base64');
    const expected = Buffer.from(keyStr, 'base64');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const key = scryptSync(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(key, expected);
  },
};

/**
 * Hashes a password using argon2id (or scrypt fallback).
 *
 * @param password - The password or MD5 digest to hash
 * @returns Promise resolving to the hash string
 */
export async function hashPassword(password: string): Promise<string> {
  const impl = getArgon2();
  return impl.hash(password, {
    type: 2, // argon2id = 2
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verifies a password against a stored hash.
 *
 * @param password - The password or MD5 digest to verify
 * @param hash - The stored hash string
 * @returns Promise resolving to true if valid, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const impl = getArgon2();
  try {
    return await impl.verify(hash, password);
  } catch {
    return false;
  }
}
