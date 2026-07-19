/**
 * Input validation helpers for untrusted packet fields.
 *
 * Every field read from a {@link PacketReader} must pass one of these before
 * use (rule 03 — never trust the client). Each helper throws {@link PacketError}
 * on failure so handlers can let the dispatcher catch uniformly.
 *
 * @module utils/validate
 */

import { PacketError } from '../errors.js';

/** Character / account name length overrides. */
export interface NameOptions {
  /** Inclusive minimum length. */
  minLength?: number;
  /** Inclusive maximum length. */
  maxLength?: number;
}

const DEFAULT_NAME_MIN = 3;
const DEFAULT_NAME_MAX = 16;
const NAME_CHARSET = /^[a-zA-Z0-9]+$/;

/**
 * Validation helpers for packet fields. Each method either returns normally
 * (valid) or throws {@link PacketError} (invalid).
 */
export const Validate = {
  /**
   * Validate a name field (account or character).
   *
   * Default bounds are 3–16 alphanumeric characters, matching the Flyff v15
   * account-name contract. Character names may override via {@link NameOptions}.
   *
   * @throws PacketError if length or charset is invalid.
   */
  name(value: string, opts: NameOptions = {}): void {
    const min = opts.minLength ?? DEFAULT_NAME_MIN;
    const max = opts.maxLength ?? DEFAULT_NAME_MAX;
    if (typeof value !== 'string' || value.length < min || value.length > max) {
      throw new PacketError(`Name length must be ${min}-${max}`);
    }
    if (!NAME_CHARSET.test(value)) {
      throw new PacketError('Name contains invalid characters');
    }
  },

  /**
   * Validate a slot index is an integer in `[0, max)`.
   *
   * @param slot - Slot index to check.
   * @param max - Exclusive upper bound (default 3 character slots).
   * @throws PacketError if out of range or non-integer.
   */
  slot(slot: number, max: number = 3): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= max) {
      throw new PacketError(`Slot out of range [0, ${max})`);
    }
  },

  /**
   * Validate an unsigned 32-bit DWORD value.
   *
   * @throws PacketError if negative, > 0xFFFFFFFF, or non-integer.
   */
  dword(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) {
      throw new PacketError('Value out of DWORD range');
    }
  },

  /**
   * Validate that all three position coordinates are finite numbers.
   *
   * @throws PacketError if any coordinate is NaN or ±Infinity.
   */
  pos(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new PacketError('Position coordinates must be finite');
    }
  },
};
