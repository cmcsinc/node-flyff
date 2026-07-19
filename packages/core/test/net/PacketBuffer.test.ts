import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { PacketBuffer, framePacket, HEADERMARK } from '../../src/net/PacketBuffer.js';

function buildPacket(opcode: number, payload: Buffer): Buffer {
  const body = Buffer.allocUnsafe(4 + payload.length);
  body.writeUInt32LE(opcode, 0);
  payload.copy(body, 4);
  return framePacket(body);
}

describe('PacketBuffer', () => {
  it('framePacket prepends ^ marker + DWORD size', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const framed = framePacket(payload);
    assert.equal(framed[0], HEADERMARK);
    assert.equal(framed.readUInt32LE(1), 3);
    assert.deepEqual(framed.subarray(5), payload);
  });

  it('drains a single complete packet', () => {
    const buf = new PacketBuffer();
    const packet = buildPacket(0xfc, Buffer.from([0x01, 0x02]));
    buf.push(packet);
    const drained = buf.drain();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].readUInt32LE(0), 0xfc);
    assert.deepEqual(drained[0].subarray(4), Buffer.from([0x01, 0x02]));
  });

  it('buffers partial packets across pushes', () => {
    const buf = new PacketBuffer();
    const packet = buildPacket(0x1234, Buffer.from([0xaa, 0xbb]));
    buf.push(packet.subarray(0, 3));
    assert.equal(buf.drain().length, 0);
    buf.push(packet.subarray(3, 7));
    assert.equal(buf.drain().length, 0);
    buf.push(packet.subarray(7));
    const drained = buf.drain();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].readUInt32LE(0), 0x1234);
  });

  it('drains multiple packets in one push', () => {
    const buf = new PacketBuffer();
    const a = buildPacket(0x00d9, Buffer.from([0x10]));
    const b = buildPacket(0x00c6, Buffer.from([0x20, 0x21]));
    buf.push(Buffer.concat([a, b]));
    const drained = buf.drain();
    assert.equal(drained.length, 2);
    assert.equal(drained[0].readUInt32LE(0), 0x00d9);
    assert.equal(drained[1].readUInt32LE(0), 0x00c6);
  });

  it('skips garbage bytes to find next header marker', () => {
    const buf = new PacketBuffer();
    const garbage = Buffer.from([0x00, 0x01, 0x02]);
    const packet = buildPacket(0xff00, Buffer.from([0xcc]));
    buf.push(Buffer.concat([garbage, packet]));
    const drained = buf.drain();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].readUInt32LE(0), 0xff00);
  });
});
