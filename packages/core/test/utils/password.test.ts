import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../src/utils/password';

describe('password utility', () => {
  describe('hashPassword', () => {
    it('should hash a plain password', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      assert.ok(hash);
      assert.ok(typeof hash === 'string');
      assert.ok(hash.length > 0);
      // PHC-format hash ($argon2id$ when the native binding is present,
      // $scrypt$ when falling back to the node:crypto KDF).
      assert.ok(hash.startsWith('$'));
    });

    it('should hash an MD5 password from v15 client', async () => {
      // Simulated MD5 hash from v15 client (32 hex chars)
      const md5Password = '5d41402abc4b2a76b9719d911017c592'; // MD5 of "hello"
      const hash = await hashPassword(md5Password);

      assert.ok(hash);
      assert.ok(hash.startsWith('$'));
    });

    it('should generate different hashes for same password (salt)', async () => {
      const password = 'samePassword';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // Different salts should produce different hashes
      assert.notEqual(hash1, hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct plain password', async () => {
      const password = 'correctPassword';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      assert.equal(isValid, true);
    });

    it('should reject incorrect plain password', async () => {
      const password = 'correctPassword';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('wrongPassword', hash);
      assert.equal(isValid, false);
    });

    it('should verify correct MD5 password', async () => {
      const md5Password = '5d41402abc4b2a76b9719d911017c592';
      const hash = await hashPassword(md5Password);

      const isValid = await verifyPassword(md5Password, hash);
      assert.equal(isValid, true);
    });

    it('should reject incorrect MD5 password', async () => {
      const md5Password = '5d41402abc4b2a76b9719d911017c592';
      const hash = await hashPassword(md5Password);

      const wrongMd5 = '098f6bcd4621d373cade4e832627b4f6'; // MD5 of "test"
      const isValid = await verifyPassword(wrongMd5, hash);
      assert.equal(isValid, false);
    });

    it('should handle empty password', async () => {
      const password = '';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      assert.equal(isValid, true);

      const isInvalid = await verifyPassword('notEmpty', hash);
      assert.equal(isInvalid, false);
    });

    it('should handle long password', async () => {
      const password = 'a'.repeat(1000);
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      assert.equal(isValid, true);
    });
  });

  describe('integration', () => {
    it('should support v15 client flow: MD5 -> argon2id', async () => {
      // Simulate v15 client sending MD5 password
      const clientMd5 = '5d41402abc4b2a76b9719d911017c592';

      // Server hashes it with argon2id for storage
      const storedHash = await hashPassword(clientMd5);

      // Later, same client sends same MD5 for login
      const isValid = await verifyPassword(clientMd5, storedHash);
      assert.equal(isValid, true);
    });

    it('should support modern client flow: plain -> argon2id', async () => {
      // Modern client sends plain password (already hashed client-side or over TLS)
      const plainPassword = 'modernSecurePassword123!';

      // Server hashes with argon2id
      const storedHash = await hashPassword(plainPassword);

      // Client sends same password for login
      const isValid = await verifyPassword(plainPassword, storedHash);
      assert.equal(isValid, true);
    });
  });
});
