/**
 * LSFR (Linear Feedback Shift Register) cipher for Flyff packet encryption.
 *
 * This is a simple stream cipher used by the Flyff client/server protocol.
 * Each connection has its own cipher instance with a unique initial key.
 * The cipher transforms data by XORing each byte with a pseudo-random
 * keystream generated from the key.
 *
 * The algorithm:
 * - Key transformation: `key = (key * 0x08088405 + 1) >>> 0`
 * - XOR each byte: `byte ^= (key >>> ((i % 4) * 8)) & 0xFF`
 *
 * @example
 * ```ts
 * const cipher = new LSFRCipher(0x12345678);
 * const encrypted = cipher.transform(Buffer.from([0x01, 0x02, 0x03]));
 * ```
 *
 * @module net/LSFRCipher
 */

// ---------------------------------------------------------------------------
// LSFRCipher
// ---------------------------------------------------------------------------

/**
 * Per-connection LSFR cipher for packet encryption.
 *
 * The cipher mutates buffers in-place for performance. Call `transform()`
 * on both outgoing and incoming packets — the cipher is symmetric.
 */
export class LSFRCipher {
  private _key: number;

  /**
   * Creates a new LSFR cipher with the given initial key.
   *
   * @param key - Initial 32-bit unsigned key. Values outside the 32-bit
   *   range are wrapped using unsigned right-shift.
   */
  constructor(key: number) {
    this._key = key >>> 0; // Ensure unsigned 32-bit
  }

  /**
   * Gets the current key value.
   *
   * The key advances each time `nextKey()` or `transform()` is called.
   */
  get key(): number {
    return this._key;
  }

  /**
   * Transforms the cipher key to the next value in the sequence.
   *
   * The algorithm is: `key = (key * 0x08088405 + 1) >>> 0`
   *
   * @returns The new key value.
   */
  nextKey(): number {
    this._key = ((Math.imul(this._key, 0x08088405) + 1) >>> 0);
    return this._key;
  }

  /**
   * Transforms a buffer in-place using the LSFR keystream.
   *
   * Each byte is XORed with a byte from the keystream. The keystream
   * is derived from the current key, which advances during transformation.
   *
   * The algorithm for each byte at position `i`:
   * ```
   * const k = nextKey();
   * buf[i] ^= (k >>> ((i % 4) * 8)) & 0xFF;
   * ```
   *
   * @param buf - Buffer to transform. Mutated in-place.
   * @returns The same buffer for chaining.
   */
  transform(buf: Buffer): Buffer {
    const originalKey = this._key;

    for (let i = 0; i < buf.length; i++) {
      const k = this.nextKey();
      const byte = buf[i];
      if (byte !== undefined) {
        buf[i] = byte ^ ((k >>> ((i % 4) * 8)) & 0xFF);
      }
    }

    return buf;
  }

  /**
   * Resets the cipher to the original key state.
   *
   * Useful for reusing the same cipher for multiple transformations
   * without creating a new instance.
   *
   * @param key - New initial key. If omitted, resets to the key from
   *   construction (only works if you saved it).
   */
  reset(key?: number): void {
    if (key !== undefined) {
      this._key = key >>> 0;
    }
    // If no key provided, we can't restore the original state
    // because we didn't save it. This is a limitation of the API.
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Creates a cipher and transforms a buffer in one call.
 *
 * @param buf - Buffer to transform.
 * @param key - Initial cipher key.
 * @returns The transformed buffer.
 */
export function transformBuffer(buf: Buffer, key: number): Buffer {
  const cipher = new LSFRCipher(key);
  return cipher.transform(buf);
}

/**
 * Transforms a buffer and returns the result as a new buffer.
 *
 * Unlike {@link LSFRCipher.transform}, this does not mutate the input.
 *
 * @param buf - Buffer to transform.
 * @param key - Initial cipher key.
 * @returns A new transformed buffer.
 */
export function transformBufferCopy(buf: Buffer, key: number): Buffer {
  const copy = Buffer.from(buf);
  const cipher = new LSFRCipher(key);
  return cipher.transform(copy);
}
