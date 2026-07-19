export const HEADERMARK = 0x5e;
export const HEADER_SIZE = 5;

export function framePacket(payload: Buffer): Buffer {
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt8(HEADERMARK, 0);
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export class PacketBuffer {
  private buffer: Buffer;

  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) {
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  drain(): Buffer[] {
    const packets: Buffer[] = [];

    while (this.buffer.length >= HEADER_SIZE) {
      if (this.buffer[0] !== HEADERMARK) {
        this.skipToNextMarker();
        if (this.buffer.length < HEADER_SIZE) break;
      }

      const payloadSize = this.buffer.readUInt32LE(1);
      const totalSize = HEADER_SIZE + payloadSize;

      if (this.buffer.length < totalSize) {
        break;
      }

      const packet = this.buffer.subarray(HEADER_SIZE, totalSize);
      packets.push(Buffer.from(packet));
      this.buffer = this.buffer.subarray(totalSize);
    }

    return packets;
  }

  private skipToNextMarker(): void {
    for (let i = 1; i < this.buffer.length; i++) {
      if (this.buffer[i] === HEADERMARK) {
        this.buffer = this.buffer.subarray(i);
        return;
      }
    }
    this.buffer = Buffer.alloc(0);
  }

  get bufferedLength(): number {
    return this.buffer.length;
  }
}
