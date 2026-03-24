import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { PacketBuffer } from './PacketBuffer.js';

const HEADER = 0x5e80;

function buildPacket(opcode: number, payload: Buffer): Buffer {
  const size = 2 + 2 + payload.length;
  const buffer = Buffer.alloc(4 + size);
  buffer.writeUInt32LE(size, 0);
  buffer.writeUInt16LE(HEADER, 4);
  buffer.writeUInt16LE(opcode, 6);
  payload.copy(buffer, 8);
  return buffer;
}

describe('PacketBuffer', () => {
  it('buffers chunks smaller than size header', () => {
    const buffer = new PacketBuffer();
    const packet = buildPacket(0xfc03, Buffer.from([0x01, 0x02]));

    buffer.push(packet.subarray(0, 2));
    assert.deepEqual(buffer.drain(), []);

    buffer.push(packet.subarray(2, 4));
    assert.deepEqual(buffer.drain(), []);

    buffer.push(packet.subarray(4));
    const packets = buffer.drain();

    assert.equal(packets.length, 1);
    assert.deepEqual(packets[0], packet.subarray(4));
  });

  it('returns nothing until full body is available', () => {
    const buffer = new PacketBuffer();
    const packet = buildPacket(0x1234, Buffer.from([0xaa, 0xbb, 0xcc]));

    buffer.push(packet.subarray(0, 6));
    assert.deepEqual(buffer.drain(), []);

    buffer.push(packet.subarray(6, 9));
    assert.deepEqual(buffer.drain(), []);

    buffer.push(packet.subarray(9));
    const packets = buffer.drain();

    assert.equal(packets.length, 1);
    assert.deepEqual(packets[0], packet.subarray(4));
  });

  it('returns multiple packets when available', () => {
    const buffer = new PacketBuffer();
    const packetA = buildPacket(0x00d9, Buffer.from([0x10]));
    const packetB = buildPacket(0x00c6, Buffer.from([0x20, 0x21]));

    buffer.push(Buffer.concat([packetA, packetB]));
    const packets = buffer.drain();

    assert.equal(packets.length, 2);
    assert.deepEqual(packets[0], packetA.subarray(4));
    assert.deepEqual(packets[1], packetB.subarray(4));
    assert.deepEqual(buffer.drain(), []);
  });
});
