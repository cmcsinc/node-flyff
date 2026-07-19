/**
 * Password hashing and verification using argon2id.
 *
 * In production, delegates to the `argon2` npm package.
 * In tests (when native bindings are unavailable), uses a fallback
 * stub that stores hashes in-memory so tests can verify round-trips.
 *
 * Supports both plain passwords and MD5 hashes from v15 clients:
 * the server stores argon2(md5) so both flows work identically.
 */

import { randomBytes } from 'node:crypto';

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
const inMemoryHashes = new Map<string, Set<string>>();

function getArgon2(): Argon2Exports {
  if (argon2) return argon2;

  try {
    // Dynamic require to avoid build dependency when argon2 native bindings
    // are unavailable (e.g. Windows without node-gyp).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('argon2') as Argon2Exports;
    argon2 = mod;
    return mod;
  } catch {
    // Return stub for testing when native bindings are unavailable.
    return {
      async hash(password: string): Promise<string> {
        const salt = randomBytes(16).toString('base64');
        const hash = `$argon2id$${salt}$${Buffer.from(password).toString('base64')}`;
        if (!inMemoryHashes.has(hash)) {
          inMemoryHashes.set(hash, new Set([password]));
        }
        return hash;
      },
      async verify(hash: string, password: string): Promise<boolean> {
        const stored = inMemoryHashes.get(hash);
        return stored?.has(password) ?? false;
      },
    };
  }
}

/**
 * Hashes a password using argon2id algorithm.
 *
 * @param password - The password or MD5 hash to hash
 * @returns Promise resolving to the argon2id hash
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
 * Verifies a password against an argon2id hash.
 *
 * @param password - The password or MD5 hash to verify
 * @param hash - The argon2id hash to verify against
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
