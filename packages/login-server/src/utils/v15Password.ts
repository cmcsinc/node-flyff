/**
 * v19 CERTIFY password crypto -- AES-128-CBC, matching the C++ `g_xRijndael`.
 *
 * The default v19 client (`__ENCRYPT_PASSWORD`, `Neuz/VersionCommon.h:235`) sends
 * the CERTIFY password as a fixed **672-byte** (`16 * MAX_PASSWORD`) Rijndael-CBC
 * blob. The shared key is the literal `"dldhsvmflvm"` zero-padded to 16 bytes
 * (`_Common/Rijndael.cpp:939`); IV is 16 zero bytes (`sm_chain0`,
 * `Rijndael.cpp:926`); AES-128 (10 rounds). Node's OpenSSL `aes-128-cbc` matches
 * the C++ byte-for-byte. On top of CBC the client applies
 * `md5("kikugalanet" + pwd)` lowercase hex -- so the 42-byte plaintext region
 * holds that 32-char digest (plus NULs).
 *
 * @module utils/v15Password
 */

import { createCipheriv, createDecipheriv } from 'node:crypto';

/** `MAX_PASSWORD` (`_Network/CmnHdr.h:485`). */
export const MAX_PASSWORD = 42;
/** Wire blob size = `16 * MAX_PASSWORD`. */
export const V15_PASSWORD_BLOB_SIZE = 16 * MAX_PASSWORD; // 672

const KEY = Buffer.from('dldhsvmflvm\0\0\0\0\0', 'latin1'); // 16 bytes
const IV = Buffer.alloc(16, 0);

/** Decrypt the 672-byte CERTIFY blob -> first 42 bytes as a UTF-8 C-string. */
export function decryptV15Password(enc: Buffer): string {
  if (enc.length !== V15_PASSWORD_BLOB_SIZE) {
    throw new Error(`v19 password blob must be ${V15_PASSWORD_BLOB_SIZE} bytes (got ${enc.length})`);
  }
  const d = createDecipheriv('aes-128-cbc', KEY, IV);
  d.setAutoPadding(false);
  const plain = Buffer.concat([d.update(enc), d.final()]);
  return plain.subarray(0, MAX_PASSWORD).toString('utf8').split('\0')[0] ?? '';
}

/**
 * Encrypt a plaintext into the 672-byte blob (client-side `SendCertify` path).
 * Mainly for tests / a scripted client; the server only decrypts.
 */
export function encryptV15Password(plaintext: string): Buffer {
  const p = Buffer.alloc(V15_PASSWORD_BLOB_SIZE, 0);
  Buffer.from(plaintext, 'utf8').copy(p, 0, 0, Math.min(MAX_PASSWORD, plaintext.length));
  const c = createCipheriv('aes-128-cbc', KEY, IV);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(p), c.final()]);
}
