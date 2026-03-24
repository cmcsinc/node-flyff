/**
 * Unit tests for signing.ts — HMAC-SHA256 message signing and verification.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { signIpcMessage, verifyIpcMessage } from '../src/signing.js';

describe('signing', () => {
  const secret = 'test-secret-key';
  const serverId = 'world-1';

  it('should generate consistent signatures for identical payloads', () => {
    const payload = { charId: 123, action: 'move' };
    const ts = 1234567890;

    const sig1 = signIpcMessage(secret, payload, serverId, ts);
    const sig2 = signIpcMessage(secret, payload, serverId, ts);

    assert.equal(sig1, sig2);
    assert.equal(typeof sig1, 'string');
    assert.equal(sig1.length, 64); // HMAC-SHA256 produces 64 hex chars
  });

  it('should generate different signatures for different payloads', () => {
    const ts = 1234567890;

    const sig1 = signIpcMessage(secret, { charId: 123 }, serverId, ts);
    const sig2 = signIpcMessage(secret, { charId: 456 }, serverId, ts);

    assert.notEqual(sig1, sig2);
  });

  it('should generate different signatures for different timestamps', () => {
    const payload = { charId: 123 };

    const sig1 = signIpcMessage(secret, payload, serverId, 1234567890);
    const sig2 = signIpcMessage(secret, payload, serverId, 1234567891);

    assert.notEqual(sig1, sig2);
  });

  it('should generate different signatures for different senders', () => {
    const payload = { charId: 123 };
    const ts = 1234567890;

    const sig1 = signIpcMessage(secret, payload, 'world-1', ts);
    const sig2 = signIpcMessage(secret, payload, 'world-2', ts);

    assert.notEqual(sig1, sig2);
  });

  it('should verify valid signatures', () => {
    const payload = { charId: 123 };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should reject invalid signatures', () => {
    const payload = { charId: 123 };
    const ts = Date.now();
    const invalidSig = 'a'.repeat(64); // 64 hex chars but wrong

    const isValid = verifyIpcMessage(secret, payload, invalidSig, serverId, ts);

    assert.strictEqual(isValid, false);
  });

  it('should reject signatures with wrong secret', () => {
    const payload = { charId: 123 };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage('wrong-secret', payload, sig, serverId, ts);

    assert.strictEqual(isValid, false);
  });

  it('should reject messages older than 30 seconds', () => {
    const payload = { charId: 123 };
    const ts = Date.now() - 31_000; // 31 seconds ago
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, false);
  });

  it('should accept messages exactly 30 seconds old', () => {
    const payload = { charId: 123 };
    const ts = Date.now() - 30_000; // Exactly 30 seconds ago
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle complex nested objects', () => {
    const payload = {
      charId: 123,
      position: { x: 100, y: 200, z: 300 },
      inventory: [
        { itemId: 1, count: 5 },
        { itemId: 2, count: 10 },
      ],
    };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle object property order independence', () => {
    const ts = Date.now();

    const sig1 = signIpcMessage(secret, { a: 1, b: 2 }, serverId, ts);
    const sig2 = signIpcMessage(secret, { b: 2, a: 1 }, serverId, ts);

    // Signatures should be the same regardless of property order
    assert.equal(sig1, sig2);
  });

  it('should handle empty objects', () => {
    const payload = {};
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle null and undefined values', () => {
    const payload = { a: null, b: undefined };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle arrays', () => {
    const payload = [1, 2, 3, 4, 5];
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle string values', () => {
    const payload = { message: 'Hello, world!' };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle numeric values including zero and negative', () => {
    const payload = { positive: 42, zero: 0, negative: -123 };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should handle boolean values', () => {
    const payload = { isOnline: true, isDead: false };
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, serverId, ts);

    const isValid = verifyIpcMessage(secret, payload, sig, serverId, ts);

    assert.strictEqual(isValid, true);
  });

  it('should reject signatures with incorrect length', () => {
    const payload = { charId: 123 };
    const ts = Date.now();
    const shortSig = 'abc';

    const isValid = verifyIpcMessage(secret, payload, shortSig, serverId, ts);

    assert.strictEqual(isValid, false);
  });

  it('should reject tampered payload', () => {
    const originalPayload = { charId: 123 };
    const ts = Date.now();
    const sig = signIpcMessage(secret, originalPayload, serverId, ts);

    const tamperedPayload = { charId: 456 };
    const isValid = verifyIpcMessage(secret, tamperedPayload, sig, serverId, ts);

    assert.strictEqual(isValid, false);
  });
});
