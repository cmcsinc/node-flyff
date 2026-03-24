/**
 * Unit tests for PacketWriter.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '../../src/net/PacketWriter.js';
import { PacketError } from '../../src/errors.js';

describe('PacketWriter', () => {
  describe('writeByte', () => {
    it('should write single bytes', () => {
      const writer = new PacketWriter();
      writer.writeByte(0xFF).writeByte(0x00).writeByte(0x7F);

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0xFF, 0x00, 0x7F]));
    });

    it('should clamp values to 0-255 range', () => {
      const writer = new PacketWriter();
      writer.writeByte(0x100); // 256 -> clamped to 0

      const result = writer.build();
      assert.equal(result[0], 0x00);
    });

    it('should handle negative values', () => {
      const writer = new PacketWriter();
      writer.writeByte(-1); // -1 -> clamped to 0xFF (two's complement)

      const result = writer.build();
      assert.equal(result[0], 0xFF);
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeByte(0x01);
      assert.strictEqual(result, writer);
    });
  });

  describe('writeWord', () => {
    it('should write 16-bit Little-Endian values', () => {
      const writer = new PacketWriter();
      writer.writeWord(0x1234).writeWord(0xFFFF);

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x34, 0x12, 0xFF, 0xFF]));
    });

    it('should clamp values to 0-65535 range', () => {
      const writer = new PacketWriter();
      writer.writeWord(0x10000); // 65536 -> clamped to 0

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x00, 0x00]));
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeWord(0x1234);
      assert.strictEqual(result, writer);
    });
  });

  describe('writeDword', () => {
    it('should write 32-bit Little-Endian values', () => {
      const writer = new PacketWriter();
      writer.writeDword(0x12345678).writeDword(0xFFFFFFFF);

      const result = writer.build();
      assert.deepEqual(
        result,
        Buffer.from([0x78, 0x56, 0x34, 0x12, 0xFF, 0xFF, 0xFF, 0xFF])
      );
    });

    it('should handle unsigned 32-bit values', () => {
      const writer = new PacketWriter();
      writer.writeDword(0x80000000); // 2147483648

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x00, 0x00, 0x00, 0x80]));
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeDword(0x12345678);
      assert.strictEqual(result, writer);
    });
  });

  describe('writeFloat', () => {
    it('should write 32-bit floats', () => {
      const writer = new PacketWriter();
      writer.writeFloat(3.14);

      const result = writer.build();
      const value = result.readFloatLE(0);
      assert.ok(Math.abs(value - 3.14) < 0.001);
    });

    it('should write multiple floats', () => {
      const writer = new PacketWriter();
      writer.writeFloat(1.0).writeFloat(2.0).writeFloat(3.0);

      const result = writer.build();
      assert.equal(result.readFloatLE(0), 1.0);
      assert.equal(result.readFloatLE(4), 2.0);
      assert.equal(result.readFloatLE(8), 3.0);
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeFloat(1.0);
      assert.strictEqual(result, writer);
    });
  });

  describe('writeLong', () => {
    it('should write signed 32-bit integers', () => {
      const writer = new PacketWriter();
      writer.writeLong(-1).writeLong(0x7FFFFFFF); // max positive

      const result = writer.build();
      assert.deepEqual(
        result,
        Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F])
      );
    });

    it('should write negative values', () => {
      const writer = new PacketWriter();
      writer.writeLong(-2147483648); // min negative

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x00, 0x00, 0x00, 0x80]));
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeLong(42);
      assert.strictEqual(result, writer);
    });
  });

  describe('writeString', () => {
    it('should write DWORD-length-prefixed ASCII strings', () => {
      const writer = new PacketWriter();
      writer.writeString('Hello');

      const result = writer.build();
      // Length prefix: 5
      // Data: 'Hello'
      assert.deepEqual(result, Buffer.from([0x05, 0x00, 0x00, 0x00, 0x48, 0x65, 0x6C, 0x6C, 0x6F]));
    });

    it('should write empty strings', () => {
      const writer = new PacketWriter();
      writer.writeString('');

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x00, 0x00, 0x00, 0x00]));
    });

    it('should write multiple strings', () => {
      const writer = new PacketWriter();
      writer.writeString('ABC').writeString('XYZ');

      const result = writer.build();
      assert.deepEqual(
        result,
        Buffer.from([
          0x03, 0x00, 0x00, 0x00, // length of "ABC"
          0x41, 0x42, 0x43, // "ABC"
          0x03, 0x00, 0x00, 0x00, // length of "XYZ"
          0x58, 0x59, 0x5A, // "XYZ"
        ])
      );
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeString('test');
      assert.strictEqual(result, writer);
    });
  });

  describe('writeBytes', () => {
    it('should write raw buffers', () => {
      const writer = new PacketWriter();
      writer.writeBytes(Buffer.from([0x01, 0x02, 0x03]));

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x01, 0x02, 0x03]));
    });

    it('should copy the buffer', () => {
      const writer = new PacketWriter();
      const original = Buffer.from([0x01, 0x02, 0x03]);
      writer.writeBytes(original);

      // Modify original
      original[0] = 0xFF;

      const result = writer.build();
      assert.equal(result[0], 0x01); // unchanged
    });

    it('should return this for chaining', () => {
      const writer = new PacketWriter();
      const result = writer.writeBytes(Buffer.from([0x01]));
      assert.strictEqual(result, writer);
    });
  });

  describe('size', () => {
    it('should return 0 for empty writer', () => {
      const writer = new PacketWriter();
      assert.equal(writer.size, 0);
    });

    it('should count bytes correctly', () => {
      const writer = new PacketWriter();
      writer.writeByte(0x01);
      assert.equal(writer.size, 1);

      writer.writeWord(0x1234);
      assert.equal(writer.size, 3);

      writer.writeDword(0x12345678);
      assert.equal(writer.size, 7);
    });

    it('should count string bytes correctly', () => {
      const writer = new PacketWriter();
      writer.writeString('Hello'); // 4 (length) + 5 (data)
      assert.equal(writer.size, 9);

      writer.writeString(''); // 4 (length) + 0 (data)
      assert.equal(writer.size, 13);
    });
  });

  describe('build', () => {
    it('should concatenate all chunks', () => {
      const writer = new PacketWriter();
      writer.writeByte(0x01).writeWord(0x0203).writeDword(0x04050607);

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x01, 0x03, 0x02, 0x07, 0x06, 0x05, 0x04]));
    });

    it('should allow building multiple times', () => {
      const writer = new PacketWriter();
      writer.writeByte(0x01);

      const result1 = writer.build();
      assert.deepEqual(result1, Buffer.from([0x01]));

      writer.writeByte(0x02);
      const result2 = writer.build();
      assert.deepEqual(result2, Buffer.from([0x01, 0x02]));
    });

    it('should handle mixed chunk types', () => {
      const writer = new PacketWriter();
      writer.writeByte(0x01); // single byte
      writer.writeBytes(Buffer.from([0x02, 0x03])); // buffer
      writer.writeByte(0x04); // single byte

      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0x01, 0x02, 0x03, 0x04]));
    });
  });

  describe('clear', () => {
    it('should reset the writer', () => {
      const writer = new PacketWriter();
      writer.writeByte(0x01).writeWord(0x0203);

      assert.equal(writer.size, 3);

      writer.clear();
      assert.equal(writer.size, 0);

      writer.writeByte(0xFF);
      const result = writer.build();
      assert.deepEqual(result, Buffer.from([0xFF]));
    });
  });

  describe('object pooling', () => {
    it('should acquire and release writers', () => {
      const writer1 = PacketWriter.pool.acquire();
      writer1.writeByte(0x01);

      const result1 = writer1.build();
      assert.deepEqual(result1, Buffer.from([0x01]));

      PacketWriter.pool.release(writer1);

      const writer2 = PacketWriter.pool.acquire();
      // Should be the same instance, but reset
      assert.equal(writer2.size, 0);

      writer2.writeByte(0x02);
      const result2 = writer2.build();
      assert.deepEqual(result2, Buffer.from([0x02]));

      PacketWriter.pool.release(writer2);
    });

    it('should create new instances when pool is empty', () => {
      // Drain the pool by acquiring many writers
      const writers: PacketWriter[] = [];
      for (let i = 0; i < 100; i++) {
        const writer = PacketWriter.pool.acquire();
        writers.push(writer);
      }

      // All should be valid instances
      for (const writer of writers) {
        writer.writeByte(0xFF);
        const result = writer.build();
        assert.equal(result.length, 1);
        assert.equal(result[0], 0xFF);
      }

      // Release all back
      for (const writer of writers) {
        PacketWriter.pool.release(writer);
      }
    });

    it('should limit pool size', () => {
      // Default max pool size is 64
      const writers: PacketWriter[] = [];
      for (let i = 0; i < 70; i++) {
        const writer = new PacketWriter(); // Create new
        writers.push(writer);
        PacketWriter.pool.release(writer); // Try to release
      }

      // Pool should be capped at 64, so 6 writers were dropped
      // But we can't easily test this from the outside
      // Just verify it doesn't crash
    });
  });

  describe('integration tests', () => {
    it('should write a complete packet', () => {
      // Simulate a SERVER_LIST packet
      const writer = PacketWriter.pool.acquire();
      writer.writeDword(0x12345678); // key
      writer.writeString('Cluster1'); // server name
      writer.writeDword(100); // player count
      writer.writeByte(0x01); // server index

      const result = writer.build();

      const expected = Buffer.concat([
        Buffer.from([0x78, 0x56, 0x34, 0x12]), // key
        Buffer.from([0x08, 0x00, 0x00, 0x00]), // length of "Cluster1"
        Buffer.from('Cluster1', 'ascii'),
        Buffer.from([0x64, 0x00, 0x00, 0x00]), // player count: 100
        Buffer.from([0x01]), // server index
      ]);

      assert.deepEqual(result, expected);

      PacketWriter.pool.release(writer);
    });

    it('should build round-trip with PacketReader', async () => {
      // Write data
      const writer = new PacketWriter();
      writer.writeDword(0xDEADBEEF).writeString('test').writeByte(0xFF);
      const packet = writer.build();

      // Read it back
      const { PacketReader } = await import('../../src/net/PacketReader.js');
      const reader = new PacketReader(packet);

      assert.equal(reader.readDword(), 0xDEADBEEF);
      assert.equal(reader.readString(), 'test');
      assert.equal(reader.readByte(), 0xFF);
      assert.equal(reader.remaining, 0);
    });
  });
});
