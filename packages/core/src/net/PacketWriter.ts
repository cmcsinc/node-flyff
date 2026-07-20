/**
 * Binary packet writer with fluent interface and object pooling.
 *
 * Builds packets by appending binary data to an internal chunks array,
 * then concatenates them in `build()`. Supports object pooling to reduce
 * GC pressure in high-throughput scenarios.
 *
 * @example
 * ```ts
 * const writer = PacketWriter.pool.acquire();
 * writer.writeDword(0x12345678)
 *       .writeString('Hello')
 *       .writeByte(0xFF);
 * const packet = writer.build();
 * PacketWriter.pool.release(writer);
 * ```
 *
 * @module net/PacketWriter
 */

import { PacketError } from '../errors.js';

// ---------------------------------------------------------------------------
// Object Pool
// ---------------------------------------------------------------------------

/**
 * Simple object pool for PacketWriter instances.
 *
 * Reuses writer instances to reduce garbage collection pressure.
 */
class PacketWriterPool {
  private readonly pool: PacketWriter[] = [];
  private readonly maxPoolSize: number;

  constructor(maxPoolSize: number = 64) {
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Acquires a PacketWriter from the pool, or creates a new one if empty.
   *
   * @returns A reset PacketWriter ready for use.
   */
  acquire(): PacketWriter {
    if (this.pool.length > 0) {
      const writer = this.pool.pop()!;
      writer.reset();
      return writer;
    }
    return new PacketWriter();
  }

  /**
   * Returns a PacketWriter to the pool for reuse.
   *
   * @param writer - The writer to release. Will be reset and stored.
   */
  release(writer: PacketWriter): void {
    if (this.pool.length < this.maxPoolSize) {
      this.pool.push(writer);
    }
    // If pool is full, just let it be GC'd
  }
}

// ---------------------------------------------------------------------------
// PacketWriter
// ---------------------------------------------------------------------------

/**
 * Writes binary packets with a fluent interface.
 *
 * Data is appended to an internal chunks array for performance, then
 * concatenated in `build()`. All integer writes are Little-Endian.
 * String writes include a DWORD length prefix.
 */
export class PacketWriter {
  /** Global object pool for reusing PacketWriter instances. */
  static readonly pool = new PacketWriterPool();

  private chunks: (Buffer | number)[] = [];

  /**
   * Creates a new PacketWriter.
   *
   * Use {@link PacketWriter.pool.acquire()} instead of `new` for
   * better performance in hot paths.
   */
  constructor() {
    // Empty constructor - initialization happens in reset()
  }

  /**
   * Resets the writer to its initial state, clearing all chunks.
   *
   * Called automatically by {@link PacketWriterPool.acquire()}.
   * @internal
   */
  reset(): void {
    this.chunks = [];
  }

  /**
   * Appends a single byte (BYTE) to the packet.
   *
   * @param value - Byte value (0–255). Values outside range are clamped.
   * @returns This writer for chaining.
   */
  writeByte(value: number): this {
    this.chunks.push(value & 0xFF);
    return this;
  }

  /**
   * Appends a 16-bit Little-Endian integer (WORD) to the packet.
   *
   * @param value - Word value (0–65535). Values outside range are clamped.
   * @returns This writer for chaining.
   */
  writeWord(value: number): this {
    const buf = Buffer.allocUnsafe(2);
    buf.writeUInt16LE(value & 0xFFFF, 0);
    this.chunks.push(buf);
    return this;
  }

  /**
   * Appends a 32-bit Little-Endian integer (DWORD) to the packet.
   *
   * @param value - Dword value (0–4294967295).
   * @returns This writer for chaining.
   */
  writeDword(value: number): this {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(value >>> 0, 0);
    this.chunks.push(buf);
    return this;
  }

  /**
   * Appends a 64-bit Little-Endian unsigned integer (Qword) to the packet.
   *
   * Flyff serializes `EXPINTEGER` (`__int64`) fields — `m_nExp1`, `m_nDeathExp`,
   * `m_nAngelExp` — as 8 bytes in `CMover::Serialize` (`ObjSerializeOpt.cpp`).
   * Writing these as DWORDs desyncs the stream and crashes the client in
   * `CItemContainer::Serialize` (garbage `chSize` → OOB `m_apItem[ch]`).
   *
   * @param value - Qword value. `number` is precise up to 2^53; pass a `bigint`
   *   for the full 64-bit range (late-game exp).
   * @returns This writer for chaining.
   */
  writeQword(value: number | bigint): this {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(typeof value === 'bigint' ? value : BigInt(value), 0);
    this.chunks.push(buf);
    return this;
  }

  /**
   * Appends a 32-bit Little-Endian float to the packet.
   *
   * @param value - Float value.
   * @returns This writer for chaining.
   */
  writeFloat(value: number): this {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(value, 0);
    this.chunks.push(buf);
    return this;
  }

  /**
   * Appends a signed 32-bit Little-Endian integer (long) to the packet.
   *
   * @param value - Long value (-2147483648–2147483647).
   * @returns This writer for chaining.
   */
  writeLong(value: number): this {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32LE(value | 0, 0);
    this.chunks.push(buf);
    return this;
  }

  /**
   * Appends a DWORD-length-prefixed ASCII string to the packet.
   *
   * Writes the string length as a DWORD (4 bytes), then the ASCII bytes.
   * The string is **not** null-terminated.
   *
   * @param value - String to write.
   * @returns This writer for chaining.
   */
  writeString(value: string): this {
    const buf = Buffer.from(value, 'ascii');
    this.writeDword(buf.length);
    this.chunks.push(buf);
    return this;
  }

  /**
   * Appends raw bytes to the packet.
   *
   * @param buffer - Buffer to append.
   * @returns This writer for chaining.
   */
  writeBytes(buffer: Buffer): this {
    this.chunks.push(Buffer.from(buffer));
    return this;
  }

  /**
   * Calculates the current packet size in bytes without building.
   *
   * @returns Total size of all chunks in bytes.
   */
  get size(): number {
    let total = 0;
    for (const chunk of this.chunks) {
      if (typeof chunk === 'number') {
        total += 1;
      } else {
        total += chunk.length;
      }
    }
    return total;
  }

  /**
   * Builds and returns the final packet as a Buffer.
   *
   * Concatenates all chunks into a single Buffer. This writer can
   * continue to be used after calling `build()` — more data will be
   * appended to the existing chunks.
   *
   * @returns The complete packet as a Buffer.
   */
  build(): Buffer {
    const result = Buffer.allocUnsafe(this.size);
    let offset = 0;

    for (const chunk of this.chunks) {
      if (typeof chunk === 'number') {
        result[offset++] = chunk;
      } else {
        chunk.copy(result, offset);
        offset += chunk.length;
      }
    }

    return result;
  }

  /**
   * Resets the writer to its initial state, clearing all chunks.
   *
   * After calling this, the writer can be reused to build a new packet.
   */
  clear(): void {
    this.chunks = [];
  }
}
