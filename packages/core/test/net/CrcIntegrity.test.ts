/**
 * Unit tests for CrcIntegrity -- Flyff packet validation.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  obfuscate,
  deobfuscate,
  computeSizeCrc,
  computePayloadCrc,
  validateSizeCrc,
  validatePayloadCrc,
} from '../../src/net/CrcIntegrity.js';

describe('CrcIntegrity', () => {
  describe('obfuscate/deobfuscate', () => {
    it('should be inverse operations', () => {
      const value = 0x12345678;
      const protocolId = 0xabcdef00;

      const obfuscated = obfuscate(value, protocolId);
      const deobfuscated = deobfuscate(obfuscated, protocolId);

      assert.equal(deobfuscated, value);
    });

    it('should handle zero values', () => {
      assert.equal(deobfuscate(obfuscate(0, 0), 0), 0);
    });

    it('should handle max values', () => {
      const max = 0xffffffff;
      assert.equal(deobfuscate(obfuscate(max, max), max), max);
    });

    it('should produce different output for different protocolIds', () => {
      const value = 12345;
      const obf1 = obfuscate(value, 100);
      const obf2 = obfuscate(value, 200);

      assert.notEqual(obf1, obf2);
    });
  });

  describe('computeSizeCrc', () => {
    it('should compute CRC for size bytes', () => {
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32LE(100, 0);
      const protocolId = 0x12345678;

      const crc = computeSizeCrc(sizeBytes, protocolId);

      assert.equal(typeof crc, 'number');
      assert.ok(crc >= 0 && crc <= 0xffffffff);
    });

    it('should produce different CRCs for different sizes', () => {
      const size1 = Buffer.alloc(4);
      size1.writeUInt32LE(100, 0);
      const size2 = Buffer.alloc(4);
      size2.writeUInt32LE(200, 0);
      const protocolId = 0x12345678;

      const crc1 = computeSizeCrc(size1, protocolId);
      const crc2 = computeSizeCrc(size2, protocolId);

      assert.notEqual(crc1, crc2);
    });

    it('should produce different CRCs for different protocolIds', () => {
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32LE(100, 0);

      const crc1 = computeSizeCrc(sizeBytes, 100);
      const crc2 = computeSizeCrc(sizeBytes, 200);

      assert.notEqual(crc1, crc2);
    });
  });

  describe('computePayloadCrc', () => {
    it('should compute CRC for payload', () => {
      const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const protocolId = 0x12345678;

      const crc = computePayloadCrc(payload, protocolId);

      assert.equal(typeof crc, 'number');
      assert.ok(crc >= 0 && crc <= 0xffffffff);
    });

    it('should produce different CRCs for different payloads', () => {
      const payload1 = Buffer.from([0x01, 0x02, 0x03]);
      const payload2 = Buffer.from([0x04, 0x05, 0x06]);
      const protocolId = 0x12345678;

      const crc1 = computePayloadCrc(payload1, protocolId);
      const crc2 = computePayloadCrc(payload2, protocolId);

      assert.notEqual(crc1, crc2);
    });

    it('should handle empty payload', () => {
      const payload = Buffer.alloc(0);
      const protocolId = 0x12345678;

      const crc = computePayloadCrc(payload, protocolId);

      assert.equal(typeof crc, 'number');
    });
  });

  describe('validateSizeCrc', () => {
    it('should validate correct CRC', () => {
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32LE(100, 0);
      const protocolId = 0x12345678;

      const crc = computeSizeCrc(sizeBytes, protocolId);
      const valid = validateSizeCrc(sizeBytes, crc, protocolId);

      assert.equal(valid, true);
    });

    it('should reject incorrect CRC', () => {
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32LE(100, 0);
      const protocolId = 0x12345678;

      const wrongCrc = 0xdeadbeef;
      const valid = validateSizeCrc(sizeBytes, wrongCrc, protocolId);

      assert.equal(valid, false);
    });

    it('should reject CRC computed with wrong protocolId', () => {
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32LE(100, 0);

      const crc = computeSizeCrc(sizeBytes, 100);
      const valid = validateSizeCrc(sizeBytes, crc, 200);

      assert.equal(valid, false);
    });
  });

  describe('validatePayloadCrc', () => {
    it('should validate correct CRC', () => {
      const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const protocolId = 0x12345678;

      const crc = computePayloadCrc(payload, protocolId);
      const valid = validatePayloadCrc(payload, crc, protocolId);

      assert.equal(valid, true);
    });

    it('should reject incorrect CRC', () => {
      const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const protocolId = 0x12345678;

      const wrongCrc = 0xdeadbeef;
      const valid = validatePayloadCrc(payload, wrongCrc, protocolId);

      assert.equal(valid, false);
    });

    it('should reject CRC computed with wrong protocolId', () => {
      const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);

      const crc = computePayloadCrc(payload, 100);
      const valid = validatePayloadCrc(payload, crc, 200);

      assert.equal(valid, false);
    });

    it('should handle empty payload', () => {
      const payload = Buffer.alloc(0);
      const protocolId = 0x12345678;

      const crc = computePayloadCrc(payload, protocolId);
      const valid = validatePayloadCrc(payload, crc, protocolId);

      assert.equal(valid, true);
    });
  });

  describe('round-trip integration', () => {
    it('should validate size and payload together', () => {
      const size = 100;
      const sizeBytes = Buffer.alloc(4);
      sizeBytes.writeUInt32LE(size, 0);
      const payload = Buffer.alloc(size);
      payload.fill(0xab);
      const protocolId = 0x12345678;

      const sizeCrc = computeSizeCrc(sizeBytes, protocolId);
      const payloadCrc = computePayloadCrc(payload, protocolId);

      assert.equal(validateSizeCrc(sizeBytes, sizeCrc, protocolId), true);
      assert.equal(validatePayloadCrc(payload, payloadCrc, protocolId), true);
    });
  });
});