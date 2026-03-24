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

    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      const totalSize = 4 + size;

      if (this.buffer.length < totalSize) {
        break;
      }

      const packet = this.buffer.slice(4, totalSize);
      packets.push(packet);
      this.buffer = this.buffer.slice(totalSize);
    }

    return packets;
  }
}
