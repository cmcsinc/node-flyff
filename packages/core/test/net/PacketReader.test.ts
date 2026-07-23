/**
 * Unit tests for PacketReader.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '../../src/net/PacketReader';
import { PacketError } from '../../src/errors';

describe('PacketReader', () => {
  describe('constructor', () => {
    it('should create a reader with offset=0', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const reader = new PacketReader(buf);
      assert.equal(reader.offset, 0);
      assert.equal(reader.remaining, 3);
    });

    it('should throw PacketError for empty buffer', () => {
      assert.throws(
        () => new PacketReader(Buffer.alloc(0)),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /empty buffer/);
          return true;
        }
      );
    });
  });

  describe('readByte', () => {
    it('should read single bytes', () => {
      const buf = Buffer.from([0xFF, 0x00, 0x7F]);
      const reader = new PacketReader(buf);

      assert.equal(reader.readByte(), 0xFF);
      assert.equal(reader.readByte(), 0x00);
      assert.equal(reader.readByte(), 0x7F);
    });

    it('should advance offset by 1', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const reader = new PacketReader(buf);

      assert.equal(reader.offset, 0);
      reader.readByte();
      assert.equal(reader.offset, 1);
      reader.readByte();
      assert.equal(reader.offset, 2);
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x01]);
      const reader = new PacketReader(buf);

      reader.readByte(); // OK

      assert.throws(
        () => reader.readByte(),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readByte/);
          return true;
        }
      );
    });
  });

  describe('readWord', () => {
    it('should read 16-bit Little-Endian values', () => {
      const buf = Buffer.from([0x34, 0x12, 0xFF, 0xFF]);
      const reader = new PacketReader(buf);

      assert.equal(reader.readWord(), 0x1234); // Little-Endian
      assert.equal(reader.readWord(), 0xFFFF);
    });

    it('should advance offset by 2', () => {
      const buf = Buffer.from([0x01, 0x00, 0x02, 0x00]);
      const reader = new PacketReader(buf);

      assert.equal(reader.offset, 0);
      reader.readWord();
      assert.equal(reader.offset, 2);
      reader.readWord();
      assert.equal(reader.offset, 4);
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x01]);
      const reader = new PacketReader(buf);

      assert.throws(
        () => reader.readWord(),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readWord/);
          return true;
        }
      );
    });
  });

  describe('readDword', () => {
    it('should read 32-bit Little-Endian values', () => {
      const buf = Buffer.from([0x78, 0x56, 0x34, 0x12, 0xFF, 0xFF, 0xFF, 0xFF]);
      const reader = new PacketReader(buf);

      assert.equal(reader.readDword(), 0x12345678); // Little-Endian
      assert.equal(reader.readDword(), 0xFFFFFFFF);
    });

    it('should advance offset by 4', () => {
      const buf = Buffer.from([0x01, 0x00, 0x00, 0x00]);
      const reader = new PacketReader(buf);

      assert.equal(reader.offset, 0);
      reader.readDword();
      assert.equal(reader.offset, 4);
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const reader = new PacketReader(buf);

      assert.throws(
        () => reader.readDword(),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readDword/);
          return true;
        }
      );
    });
  });

  describe('readFloat', () => {
    it('should read 32-bit floats', () => {
      const buf = Buffer.alloc(4);
      buf.writeFloatLE(3.14, 0);
      const reader = new PacketReader(buf);

      const value = reader.readFloat();
      assert.ok(Math.abs(value - 3.14) < 0.001);
    });

    it('should advance offset by 4', () => {
      const buf = Buffer.alloc(8);
      buf.writeFloatLE(1.0, 0);
      buf.writeFloatLE(2.0, 4);
      const reader = new PacketReader(buf);

      reader.readFloat();
      assert.equal(reader.offset, 4);

      reader.readFloat();
      assert.equal(reader.offset, 8);
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const reader = new PacketReader(buf);

      assert.throws(
        () => reader.readFloat(),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readFloat/);
          return true;
        }
      );
    });
  });

  describe('readLong', () => {
    it('should read signed 32-bit integers', () => {
      const buf = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]); // -1 in two's complement
      const reader = new PacketReader(buf);

      assert.equal(reader.readLong(), -1);
    });

    it('should read negative values', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x80]); // -2147483648
      const reader = new PacketReader(buf);

      assert.equal(reader.readLong(), -2147483648);
    });

    it('should advance offset by 4', () => {
      const buf = Buffer.from([0x01, 0x00, 0x00, 0x00]);
      const reader = new PacketReader(buf);

      reader.readLong();
      assert.equal(reader.offset, 4);
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const reader = new PacketReader(buf);

      assert.throws(
        () => reader.readLong(),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readLong/);
          return true;
        }
      );
    });
  });

  describe('readString', () => {
    it('should read DWORD-length-prefixed ASCII strings', () => {
      const buf = Buffer.concat([
        Buffer.from([0x05, 0x00, 0x00, 0x00]), // length prefix: 5
        Buffer.from('Hello', 'ascii'),
      ]);
      const reader = new PacketReader(buf);

      assert.equal(reader.readString(), 'Hello');
    });

    it('should read empty strings (length=0)', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const reader = new PacketReader(buf);

      assert.equal(reader.readString(), '');
    });

    it('should advance offset correctly', () => {
      const buf = Buffer.concat([
        Buffer.from([0x03, 0x00, 0x00, 0x00]), // length prefix: 3
        Buffer.from('ABC', 'ascii'),
        Buffer.from([0xFF]), // trailing byte
      ]);
      const reader = new PacketReader(buf);

      reader.readString();
      assert.equal(reader.offset, 7); // 4 (length) + 3 (data)
      assert.equal(reader.readByte(), 0xFF);
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x05, 0x00, 0x00, 0x00, 0x41, 0x42]); // claims 5 bytes, only 2 available
      const reader = new PacketReader(buf);

      assert.throws(
        () => reader.readString(),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readString/);
          return true;
        }
      );
    });
  });

  describe('readBytes', () => {
    it('should read raw bytes', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
      const reader = new PacketReader(buf);

      const slice = reader.readBytes(3);
      assert.deepEqual(Buffer.from(slice), Buffer.from([0x01, 0x02, 0x03]));
    });

    it('should advance offset', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const reader = new PacketReader(buf);

      reader.readBytes(2);
      assert.equal(reader.offset, 2);

      const remaining = reader.readBytes(2);
      assert.deepEqual(Buffer.from(remaining), Buffer.from([0x03, 0x04]));
    });

    it('should throw PacketError on buffer overrun', () => {
      const buf = Buffer.from([0x01, 0x02]);
      const reader = new PacketReader(buf);

      assert.throws(
        () => reader.readBytes(5),
        (err: Error) => {
          assert.ok(err instanceof PacketError);
          assert.match(err.message, /Buffer overrun/);
          assert.match(err.message, /readBytes/);
          return true;
        }
      );
    });
  });

  describe('reset', () => {
    it('should reset offset to 0', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const reader = new PacketReader(buf);

      reader.readByte();
      reader.readByte();
      assert.equal(reader.offset, 2);

      reader.reset();
      assert.equal(reader.offset, 0);
      assert.equal(reader.remaining, 3);

      // Can read again from start
      assert.equal(reader.readByte(), 0x01);
    });
  });

  describe('sliceRemaining', () => {
    it('should return remaining bytes without advancing offset', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const reader = new PacketReader(buf);

      reader.readByte();
      reader.readByte();

      const remaining = reader.sliceRemaining();
      assert.deepEqual(Buffer.from(remaining), Buffer.from([0x03, 0x04]));
      assert.equal(reader.offset, 2); // unchanged
    });

    it('should return empty buffer when at end', () => {
      const buf = Buffer.from([0x01]);
      const reader = new PacketReader(buf);

      reader.readByte();

      const remaining = reader.sliceRemaining();
      assert.equal(remaining.length, 0);
    });
  });

  describe('integration tests', () => {
    it('should read a complex packet structure', () => {
      // Simulate LOGIN_CERTIFY packet:
      // DWORD key, STRING username, STRING md5pw, DWORD version
      const username = 'testuser';
      const md5pw = '5d41402abc4b2a76b9719d911017c592';
      const version = 0x0F01;

      const usernameBuf = Buffer.from(username, 'ascii');
      const md5pwBuf = Buffer.from(md5pw, 'ascii');

      const buf = Buffer.concat([
        Buffer.from([0x78, 0x56, 0x34, 0x12]), // key: 0x12345678
        Buffer.from([usernameBuf.length, 0x00, 0x00, 0x00]), // username length
        usernameBuf,
        Buffer.from([md5pwBuf.length, 0x00, 0x00, 0x00]), // md5pw length
        md5pwBuf,
        Buffer.from([0x01, 0x0F, 0x00, 0x00]), // version
      ]);

      const reader = new PacketReader(buf);

      const key = reader.readDword();
      assert.equal(key, 0x12345678);

      const readUsername = reader.readString();
      assert.equal(readUsername, username);

      const readMd5pw = reader.readString();
      assert.equal(readMd5pw, md5pw);

      const readVersion = reader.readDword();
      assert.equal(readVersion, version);

      assert.equal(reader.remaining, 0);
    });
  });
});
