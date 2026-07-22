import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  decryptV15Password, encryptV15Password, V15_PASSWORD_BLOB_SIZE, MAX_PASSWORD,
} from '../../src/utils/v15Password.js';

describe('v15 password crypto (AES-128-CBC, key dldhsvmflvm)', () => {
  it('encrypts to the fixed 672-byte blob size', () => {
    assert.equal(encryptV15Password('hunter2').length, V15_PASSWORD_BLOB_SIZE);
    assert.equal(V15_PASSWORD_BLOB_SIZE, 672);
    assert.equal(MAX_PASSWORD, 42);
  });

  it('round-trips encrypt -> decrypt', () => {
    const pw = 'kikugalanet-md5-placeholder-32-hex!!';
    assert.equal(decryptV15Password(encryptV15Password(pw)), pw);
  });

  it('round-trips a 32-char md5-hex digest (the real client payload shape)', () => {
    const md5hex = '0123456789abcdef0123456789abcdef';
    assert.equal(decryptV15Password(encryptV15Password(md5hex)), md5hex);
  });

  it('truncates plaintexts longer than MAX_PASSWORD (42)', () => {
    const round = decryptV15Password(encryptV15Password('x'.repeat(60)));
    assert.equal(round.length, 42);
    assert.equal(round, 'x'.repeat(42));
  });

  it('rejects a wrong-size blob', () => {
    assert.throws(() => decryptV15Password(Buffer.alloc(100)), /672 bytes/);
  });

  it('two encryptions of the same plaintext are identical (deterministic IV=0)', () => {
    assert.deepEqual(encryptV15Password('abc'), encryptV15Password('abc'));
  });
});
