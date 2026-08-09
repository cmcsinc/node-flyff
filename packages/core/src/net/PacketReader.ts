/**
 * Binary packet reader with offset-based sequential access.
 *
 * Provides methods to read Flyff protocol types from a Buffer while
 * automatically advancing an internal offset pointer. All reads are
 * Little-Endian as per the Flyff protocol specification.
 *
 * @example
 * ```ts
 * const reader = new PacketReader(buffer);
 * const key = reader.readDword();
 * const username = reader.readString();
 * const md5pw = reader.readString();
 * ```
 *
 * @module net/PacketReader
 */

import { PacketError } from '../errors';

// ---------------------------------------------------------------------------
// Type Aliases
// ---------------------------------------------------------------------------

/**
 * Unsigned 8-bit integer (BYTE in C++).
 */
export type Byte = number;

/**
 * Unsigned 16-bit integer (WORD in C++).
 */
export type Word = number;

/**
 * Unsigned 32-bit integer (DWORD in C++).
 */
export type Dword = number;

/**
 * Signed 32-bit integer (int/long in C++).
 */
export type Long = number;

// ---------------------------------------------------------------------------
// PacketReader
// ---------------------------------------------------------------------------

/**
 * Reads binary packets with an auto-advancing offset pointer.
 *
 * All methods throw {@link PacketError} if attempting to read beyond
 * the buffer bounds.
 */
export class PacketReader {
  private _offset = 0;

  /**
   * Creates a new PacketReader.
   *
   * @param buffer - The buffer to read from. The reader holds a reference
   *   to this buffer and does not copy it.
   */
  constructor(public readonly buffer: Buffer) {
    if (buffer.length === 0) {
      throw new PacketError('Cannot create PacketReader from empty buffer');
    }
  }

  /**
   * Current read offset in bytes.
   */
  get offset(): number {
    return this._offset;
  }

  /**
   * Number of bytes remaining to be read.
   */
  get remaining(): number {
    return this.buffer.length - this._offset;
  }

  /**
   * Throws PacketError if not enough bytes remain to read `size` bytes.
   */
  private checkBounds(size: number, methodName: string): void {
    if (this._offset + size > this.buffer.length) {
      throw new PacketError(
        `${methodName}: Buffer overrun (offset=${String(this._offset)}, ` +
          `requested=${String(size)}, remaining=${String(this.remaining)})`
      );
    }
  }

  /**
   * Reads an unsigned 8-bit integer (BYTE).
   *
   * @returns The byte value (0-255).
   */
  readByte(): Byte {
    this.checkBounds(1, 'readByte');
    const value = this.buffer.readUInt8(this._offset);
    this._offset += 1;
    return value;
  }

  /**
   * Reads an unsigned 16-bit Little-Endian integer (WORD).
   *
   * @returns The word value (0-65535).
   */
  readWord(): Word {
    this.checkBounds(2, 'readWord');
    const value = this.buffer.readUInt16LE(this._offset);
    this._offset += 2;
    return value;
  }

  /**
   * Reads an unsigned 32-bit Little-Endian integer (DWORD).
   *
   * @returns The dword value (0-4294967295).
   */
  readDword(): Dword {
    this.checkBounds(4, 'readDword');
    const value = this.buffer.readUInt32LE(this._offset);
    this._offset += 4;
    return value;
  }

  /**
   * Reads a 32-bit Little-Endian floating-point number.
   *
   * @returns The float value.
   */
  readFloat(): number {
    this.checkBounds(4, 'readFloat');
    const value = this.buffer.readFloatLE(this._offset);
    this._offset += 4;
    return value;
  }

  /**
   * Reads a signed 32-bit Little-Endian integer (int/long).
   *
   * @returns The long value (-2147483648-2147483647).
   */
  readLong(): Long {
    this.checkBounds(4, 'readLong');
    const value = this.buffer.readInt32LE(this._offset);
    this._offset += 4;
    return value;
  }

  /**
   * Reads an unsigned 64-bit Little-Endian integer (Qword / C++ `__int64`).
   *
   * Pairs with {@link PacketWriter.writeQword} -- the bit pattern is preserved
   * exactly, which is what echo fields like PLAYERMOVED's `nTickCount` need
   * (semantically signed `__int64`, but only echoed, never interpreted).
   * `bigint` because `number` loses precision past 2^53.
   *
   * @returns The qword value as a `bigint`.
   */
  readQword(): bigint {
    this.checkBounds(8, 'readQword');
    const value = this.buffer.readBigUInt64LE(this._offset);
    this._offset += 8;
    return value;
  }

  /**
   * Reads a DWORD-length-prefixed ASCII string.
   *
   * First reads a DWORD (4 bytes) for the string length, then reads that
   * many ASCII bytes. The string is **not** null-terminated.
   *
   * @returns The decoded string.
   */
  readString(): string {
    // Read the length prefix
    const length = this.readDword();

    // Bounds check the string data
    this.checkBounds(length, 'readString');

    // Slice and decode
    const slice = this.buffer.subarray(this._offset, this._offset + length);
    this._offset += length;

    return slice.toString('ascii');
  }

  /**
   * Reads exactly `length` bytes as a Buffer without decoding.
   *
   * @param length - Number of bytes to read.
   * @returns A new Buffer containing the bytes.
   */
  readBytes(length: number): Buffer {
    this.checkBounds(length, 'readBytes');
    const slice = this.buffer.subarray(this._offset, this._offset + length);
    this._offset += length;
    return Buffer.from(slice);
  }

  /**
   * Resets the offset to 0, allowing the buffer to be read again.
   */
  reset(): void {
    this._offset = 0;
  }

  /**
   * Returns a slice of the buffer from the current offset to the end.
   *
   * Does **not** advance the offset.
   *
   * @returns A Buffer containing the remaining bytes.
   */
  sliceRemaining(): Buffer {
    return this.buffer.subarray(this._offset);
  }
}
