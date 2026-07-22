/**
 * Custom error hierarchy for the Flyff emulator.
 *
 * All custom errors extend {@link FlyffError} so handlers can discriminate
 * between error categories using `instanceof` checks.
 *
 * @module errors
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * Base error class for all Flyff emulator errors.
 *
 * @example
 * ```ts
 * throw new PacketError('Malformed LOGIN_CERTIFY packet');
 * ```
 */
export class FlyffError extends Error {
  /** Machine-readable error category code. */
  readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;

    // Node 16+ native cause chaining
    if (cause !== undefined) {
      this.cause = cause;
    }

    // Ensure correct prototype chain for `instanceof` checks across
    // transpilation boundaries (TypeScript extending built-ins).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Subclasses
// ---------------------------------------------------------------------------

/**
 * Thrown when a received packet is malformed, truncated, or contains values
 * that fail validation (e.g. out-of-range slot index, oversized string).
 */
export class PacketError extends FlyffError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PACKET_ERROR', cause);
  }
}

/**
 * Thrown when authentication fails -- invalid credentials, expired token,
 * session mismatch, or wrong session state for the requested operation.
 */
export class AuthError extends FlyffError {
  constructor(message: string, cause?: unknown) {
    super(message, 'AUTH_ERROR', cause);
  }
}

/**
 * Thrown when a game logic rule is violated -- insufficient gold, invalid
 * inventory operation, anti-cheat rejection, etc.
 */
export class GameError extends FlyffError {
  constructor(message: string, cause?: unknown) {
    super(message, 'GAME_ERROR', cause);
  }
}
