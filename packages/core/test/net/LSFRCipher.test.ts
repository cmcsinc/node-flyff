/**
 * Unit tests for LSFRCipher.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LSFRCipher, transformBuffer, transformBufferCopy } from '../../src/net/LSFRCipher';

describe('LSFRCipher', () => {
  describe('constructor', () => {
    it('should store the initial key as unsigned 32-bit', () => {
      const cipher = new LSFRCipher(0x12345678);
      assert.equal(cipher.key, 0x12345678);
    });

    it('should wrap negative keys to unsigned', () => {
      const cipher = new LSFRCipher(-1);
      assert.equal(cipher.key, 0xFFFFFFFF);
    });

    it('should truncate large keys to 32 bits', () => {
      const cipher = new LSFRCipher(0x123456789ABC); // 48 bits
      // >>> 0 operator converts to unsigned 32-bit, which for this value is 1450744508
      assert.equal(cipher.key, 1450744508);
    });

    it('should handle zero key', () => {
      const cipher = new LSFRCipher(0);
      assert.equal(cipher.key, 0);
    });
  });

  describe('nextKey', () => {
    it('should transform key using the LSFR algorithm', () => {
      const cipher = new LSFRCipher(0x12345678);
      const next = cipher.nextKey();

      // Algorithm: key = (key * 0x08088405 + 1) >>> 0
      // Using Math.imul for proper 32-bit multiplication
      const expected = (Math.imul(0x12345678, 0x08088405) + 1) >>> 0;
      assert.equal(next, expected);
    });

    it('should advance the key on each call', () => {
      const cipher = new LSFRCipher(1);

      const k1 = cipher.nextKey();
      const k2 = cipher.nextKey();
      const k3 = cipher.nextKey();

      assert.notEqual(k1, k2);
      assert.notEqual(k2, k3);
      assert.notEqual(k1, k3);
    });

    it('should handle key overflow', () => {
      const cipher = new LSFRCipher(0xFFFFFFFF);
      const next = cipher.nextKey();

      // Should wrap around due to unsigned overflow
      // Using Math.imul for proper 32-bit multiplication
      assert.equal(next, ((Math.imul(0xFFFFFFFF, 0x08088405) + 1) >>> 0));
    });

    it('should update the key property', () => {
      const cipher = new LSFRCipher(42);
      const initialKey = cipher.key;

      cipher.nextKey();
      assert.notEqual(cipher.key, initialKey);
    });
  });

  describe('transform', () => {
    it('should transform a single byte', () => {
      const cipher = new LSFRCipher(0x12345678);
      const buf = Buffer.from([0xFF]);

      cipher.transform(buf);

      // First byte XORed with (nextKey() >>> (0 * 8)) & 0xFF
      // Key advances before first XOR: nextKey() called
      const expectedKey = (Math.imul(0x12345678, 0x08088405) + 1) >>> 0;
      const expectedByte = 0xFF ^ (expectedKey & 0xFF);

      assert.equal(buf[0], expectedByte);
    });

    it('should transform multiple bytes', () => {
      const cipher = new LSFRCipher(0x12345678);
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);

      cipher.transform(buf);

      // Each byte should be different
      assert.notEqual(buf[0], 0x01);
      assert.notEqual(buf[1], 0x02);
      assert.notEqual(buf[2], 0x03);
      assert.notEqual(buf[3], 0x04);
    });

    it('should mutate the buffer in-place', () => {
      const cipher = new LSFRCipher(42);
      const buf = Buffer.from([0x01, 0x02, 0x03]);

      const result = cipher.transform(buf);

      // Result is the same buffer
      assert.strictEqual(result, buf);

      // Buffer is modified
      assert.notDeepEqual(result, Buffer.from([0x01, 0x02, 0x03]));
    });

    it('should return the buffer for chaining', () => {
      const cipher = new LSFRCipher(42);
      const buf = Buffer.from([0x01]);

      const result = cipher.transform(buf);
      assert.strictEqual(result, buf);
    });

    it('should handle empty buffer', () => {
      const cipher = new LSFRCipher(42);
      const buf = Buffer.alloc(0);

      const result = cipher.transform(buf);
      assert.strictEqual(result, buf);
      assert.equal(result.length, 0);
    });

    it('should transform zero bytes to non-zero', () => {
      const cipher = new LSFRCipher(0xFFFFFFFF);
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);

      cipher.transform(buf);

      // At least some bytes should be non-zero
      const hasNonZero = buf.some((byte) => byte !== 0);
      assert.ok(hasNonZero);
    });
  });

  describe('reversibility', () => {
    it('should be reversible with same key', () => {
      const key = 0x12345678;
      const original = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);

      // Encrypt
      const cipher1 = new LSFRCipher(key);
      const encrypted = Buffer.from(cipher1.transform(Buffer.from(original)));

      // Decrypt (with fresh cipher instance at same key)
      const cipher2 = new LSFRCipher(key);
      const decrypted = Buffer.from(cipher2.transform(Buffer.from(encrypted)));

      assert.deepEqual(decrypted, original);
    });

    it('should be reversible across multiple transformations', () => {
      const key = 999999;
      const original = Buffer.from('Hello, World!', 'ascii');

      const cipher1 = new LSFRCipher(key);
      const encrypted = Buffer.from(cipher1.transform(Buffer.from(original)));

      const cipher2 = new LSFRCipher(key);
      const decrypted = Buffer.from(cipher2.transform(Buffer.from(encrypted)));

      assert.deepEqual(decrypted, original);
    });

    it('should NOT be reversible with different keys', () => {
      const original = Buffer.from([0x01, 0x02, 0x03]);

      const cipher1 = new LSFRCipher(111);
      const encrypted = Buffer.from(cipher1.transform(Buffer.from(original)));

      const cipher2 = new LSFRCipher(222); // Different key!
      const decrypted = cipher2.transform(Buffer.from(encrypted));

      assert.notDeepEqual(decrypted, original);
    });

    it('should handle round-trip for larger buffers', () => {
      const key = 0xDEADBEEF;
      const original = Buffer.alloc(1024);
      for (let i = 0; i < 1024; i++) {
        original[i] = i & 0xFF;
      }

      const cipher1 = new LSFRCipher(key);
      const encrypted = Buffer.from(cipher1.transform(Buffer.from(original)));

      const cipher2 = new LSFRCipher(key);
      const decrypted = Buffer.from(cipher2.transform(Buffer.from(encrypted)));

      assert.deepEqual(decrypted, original);
    });
  });

  describe('key advancement', () => {
    it('should advance key during transform', () => {
      const key = 0x12345678;
      const cipher = new LSFRCipher(key);

      const initialKey = cipher.key;
      cipher.transform(Buffer.from([0x01, 0x02, 0x03, 0x04]));

      // Key should have advanced 4 times (once per byte)
      assert.notEqual(cipher.key, initialKey);
    });

    it('should use different key bytes for different positions', () => {
      const key = 0x12345678;
      const cipher = new LSFRCipher(key);

      const buf = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);
      cipher.transform(buf);

      // Each byte should be different because the key advances
      // and we XOR with different bytes of the key
      assert.notEqual(buf[0], buf[1]);
      assert.notEqual(buf[1], buf[2]);
      assert.notEqual(buf[2], buf[3]);
    });
  });

  describe('reset', () => {
    it('should reset to a new key', () => {
      const cipher = new LSFRCipher(42);
      cipher.nextKey();
      cipher.nextKey();
      assert.notEqual(cipher.key, 42);

      cipher.reset(100);
      assert.equal(cipher.key, 100);
    });

    it('should allow reusing the cipher', () => {
      const cipher = new LSFRCipher(42);

      const buf1 = Buffer.from([0x01]);
      cipher.transform(buf1);

      cipher.reset(42);

      const buf2 = Buffer.from([0x01]);
      cipher.transform(buf2);

      // Should be same transformation
      assert.equal(buf1[0], buf2[0]);
    });
  });
});

describe('Utility Functions', () => {
  describe('transformBuffer', () => {
    it('should transform a buffer in-place', () => {
      const key = 42;
      const buf = Buffer.from([0x01, 0x02, 0x03]);

      const result = transformBuffer(buf, key);

      assert.strictEqual(result, buf); // Same buffer
      assert.notDeepEqual(result, Buffer.from([0x01, 0x02, 0x03])); // Modified
    });

    it('should be reversible', () => {
      const key = 12345;
      const original = Buffer.from([0x01, 0x02, 0x03]);

      const encrypted = transformBuffer(Buffer.from(original), key);
      const decrypted = transformBuffer(Buffer.from(encrypted), key);

      assert.deepEqual(decrypted, original);
    });
  });

  describe('transformBufferCopy', () => {
    it('should not mutate the input buffer', () => {
      const key = 42;
      const original = Buffer.from([0x01, 0x02, 0x03]);

      const result = transformBufferCopy(original, key);

      assert.notStrictEqual(result, original); // Different buffer
      assert.deepEqual(original, Buffer.from([0x01, 0x02, 0x03])); // Unchanged
    });

    it('should return a transformed copy', () => {
      const key = 42;
      const original = Buffer.from([0x01, 0x02, 0x03]);

      const result = transformBufferCopy(original, key);

      assert.notDeepEqual(result, original);
      assert.equal(result.length, original.length);
    });

    it('should be reversible with copies', () => {
      const key = 12345;
      const original = Buffer.from([0x01, 0x02, 0x03]);

      const encrypted = transformBufferCopy(original, key);
      const decrypted = transformBufferCopy(encrypted, key);

      assert.deepEqual(decrypted, original);
      assert.notStrictEqual(encrypted, original);
      assert.notStrictEqual(decrypted, encrypted);
      assert.notStrictEqual(decrypted, original);
    });
  });
});

describe('Integration Tests', () => {
  it('should work with PacketWriter and PacketReader round-trip', async () => {
    const { PacketWriter } = await import('../../src/net/PacketWriter');
    const { PacketReader } = await import('../../src/net/PacketReader');

    const key = 0x12345678;

    // Write a packet
    const writer = new PacketWriter();
    writer.writeDword(0xDEADBEEF).writeString('test').writeByte(0xFF);
    const packet = writer.build();

    // Encrypt
    const cipher1 = new LSFRCipher(key);
    const encrypted = Buffer.from(cipher1.transform(Buffer.from(packet)));

    // Decrypt
    const cipher2 = new LSFRCipher(key);
    const decrypted = Buffer.from(cipher2.transform(Buffer.from(encrypted)));

    // Read back
    const reader = new PacketReader(decrypted);
    assert.equal(reader.readDword(), 0xDEADBEEF);
    assert.equal(reader.readString(), 'test');
    assert.equal(reader.readByte(), 0xFF);
    assert.equal(reader.remaining, 0);
  });

  it('should handle realistic packet sizes', async () => {
    const { PacketWriter } = await import('../../src/net/PacketWriter');
    const { PacketReader } = await import('../../src/net/PacketReader');

    const key = 999999;

    // Write a larger packet
    const writer = new PacketWriter();
    writer.writeDword(0x12345678);
    writer.writeString('ClusterServer1');
    writer.writeDword(150); // player count
    writer.writeByte(0x01); // server index
    writer.writeWord(38100); // port

    const packet = writer.build();

    // Encrypt/Decrypt round-trip
    const cipher1 = new LSFRCipher(key);
    const encrypted = Buffer.from(cipher1.transform(Buffer.from(packet)));

    const cipher2 = new LSFRCipher(key);
    const decrypted = Buffer.from(cipher2.transform(Buffer.from(encrypted)));

    // Verify
    const reader = new PacketReader(decrypted);
    assert.equal(reader.readDword(), 0x12345678);
    assert.equal(reader.readString(), 'ClusterServer1');
    assert.equal(reader.readDword(), 150);
    assert.equal(reader.readByte(), 0x01);
    assert.equal(reader.readWord(), 38100);
    assert.equal(reader.remaining, 0);
  });
});
