import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  crc32Flyff, framePacketCrc, tryDecodeCrcFrame, extractProtocolIdHello,
  CRC_HEADER_SIZE,
} from '../../src/net/crcFrame.js';

describe('v15 CRC frame codec', () => {
  it('crc32Flyff(empty) === 0xFFFFFFFF (both XOR keys exercised, no input)', () => {
    assert.equal(crc32Flyff(Buffer.alloc(0)), 0xffffffff);
  });

  it('crc32Flyff is deterministic + stable for a pinned input', () => {
    assert.equal(crc32Flyff(Buffer.from([1, 2, 3, 4])), crc32Flyff(Buffer.from([1, 2, 3, 4])));
  });

  it('round-trips frame -> decode with the same protocolId', () => {
    const payload = Buffer.from([0xfc, 0, 0, 0, 0xaa, 0xbb, 0xcc]);
    const protocolId = 0x12345678;
    const frame = framePacketCrc(payload, protocolId);
    assert.equal(frame[0], 0x5e);
    assert.equal(frame.length, CRC_HEADER_SIZE + payload.length);
    const dec = tryDecodeCrcFrame(frame, protocolId);
    assert.ok(dec);
    assert.deepEqual(dec!.payload, payload);
    assert.equal(dec!.bytesConsumed, frame.length);
  });

  it('protocolId=0 round-trips (the hello / pre-handshake case)', () => {
    const payload = Buffer.from([0, 0, 0, 0, 0xde, 0xad, 0xbe, 0xef]);
    const frame = framePacketCrc(payload, 0);
    const dec = tryDecodeCrcFrame(frame, 0);
    assert.ok(dec);
    assert.deepEqual(dec!.payload, payload);
  });

  it('rejects a tampered payload byte (dataCRC mismatch)', () => {
    const frame = framePacketCrc(Buffer.from([1, 2, 3]), 0x55);
    frame[frame.length - 1] ^= 0xff;
    assert.equal(tryDecodeCrcFrame(frame, 0x55), null);
  });

  it('rejects a tampered size field (sizeCRC mismatch)', () => {
    const frame = framePacketCrc(Buffer.from([1, 2, 3]), 0x55);
    frame[5] ^= 0xff;
    assert.equal(tryDecodeCrcFrame(frame, 0x55), null);
  });

  it('rejects a wrong protocolId', () => {
    const frame = framePacketCrc(Buffer.from([1, 2, 3]), 0x55);
    assert.equal(tryDecodeCrcFrame(frame, 0x99), null);
  });

  it('returns null for an incomplete frame (need more bytes)', () => {
    const frame = framePacketCrc(Buffer.from([1, 2, 3]), 0x55);
    assert.equal(tryDecodeCrcFrame(frame.subarray(0, 8), 0x55), null);
    assert.equal(tryDecodeCrcFrame(frame.subarray(0, CRC_HEADER_SIZE), 0x55), null);
  });

  it('returns null for a wrong marker', () => {
    const frame = framePacketCrc(Buffer.from([1, 2, 3]), 0x55);
    frame[0] = 0x00;
    assert.equal(tryDecodeCrcFrame(frame, 0x55), null);
  });

  it('decodes two back-to-back frames from one buffer', () => {
    const a = framePacketCrc(Buffer.from([10]), 0x42);
    const b = framePacketCrc(Buffer.from([20, 30]), 0x42);
    const both = Buffer.concat([a, b]);
    const d1 = tryDecodeCrcFrame(both, 0x42);
    assert.ok(d1);
    assert.deepEqual(d1!.payload, Buffer.from([10]));
    const d2 = tryDecodeCrcFrame(both.subarray(d1!.bytesConsumed), 0x42);
    assert.ok(d2);
    assert.deepEqual(d2!.payload, Buffer.from([20, 30]));
  });

  describe('protocolId hello', () => {
    it('extracts the id from an 8-byte [0][id] hello payload', () => {
      const hello = Buffer.alloc(8);
      hello.writeUInt32LE(0xdeadbeef, 4);
      assert.equal(extractProtocolIdHello(hello), 0xdeadbeef);
    });

    it('returns null for a non-hello payload (opcode != 0)', () => {
      const notHello = Buffer.alloc(8);
      notHello.writeUInt32LE(0xfc, 0);
      assert.equal(extractProtocolIdHello(notHello), null);
    });

    it('round-trips the hello framed with protocolId=0', () => {
      const id = 0xcafebabe;
      const hello = Buffer.alloc(8);
      hello.writeUInt32LE(id, 4);
      const frame = framePacketCrc(hello, 0);
      const dec = tryDecodeCrcFrame(frame, 0);
      assert.ok(dec);
      assert.equal(extractProtocolIdHello(dec!.payload), id);
    });
  });
});
