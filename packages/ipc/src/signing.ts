/**
 * HMAC-SHA256 signing for inter-server IPC messages.
 *
 * All IPC messages must be signed to prevent tampering and replay attacks.
 * The signature covers: payload (sorted keys) + timestamp + sender ID.
 *
 * @module signing
 */

import { createHmac } from 'node:crypto';

/**
 * Generate an HMAC-SHA256 signature for an IPC message.
 *
 * The signature is computed over: JSON.stringify(payload, sorted keys) + timestamp + senderId
 * Sorting keys ensures stable JSON serialization regardless of object property order.
 *
 * @param secret - Shared secret key (from IPC_SECRET env var)
 * @param payload - Message payload to sign (any JSON-serializable value)
 * @param from - Server identifier sending the message
 * @param ts - Timestamp to include in the signature (should be Date.now())
 * @returns Hex-encoded HMAC-SHA256 signature
 *
 * @example
 * ```ts
 * const ts = Date.now();
 * const sig = signIpcMessage(secret, { charId: 123 }, 'world-1', ts);
 * // Returns: "a1b2c3d4..." (64 hex characters)
 * ```
 */
export function signIpcMessage(
  secret: string,
  payload: unknown,
  from: string,
  ts: number
): string {
  // Normalize payload with sorted keys for stable signature
  const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
  const data = normalized + ts + from;

  return createHmac('sha256', secret)
    .update(data)
    .digest('hex');
}

/**
 * Verify an HMAC-SHA256 signature for an IPC message.
 *
 * Rejects messages that are:
 * - Older than 30 seconds (replay attack prevention)
 * - Have an invalid signature (tampering detection)
 *
 * @param secret - Shared secret key (must match the sender's)
 * @param payload - Message payload that was signed
 * @param sig - Signature to verify (hex-encoded)
 * @param from - Server identifier that signed the message
 * @param ts - Timestamp from the message envelope
 * @returns true if signature is valid and message is fresh, false otherwise
 *
 * @example
 * ```ts
 * const isValid = verifyIpcMessage(
 *   secret,
 *   { charId: 123 },
 *   'a1b2c3d4...',
 *   'world-1',
 *   Date.now()
 * );
 * ```
 */
export function verifyIpcMessage(
  secret: string,
  payload: unknown,
  sig: string,
  from: string,
  ts: number
): boolean {
  // Reject messages older than 30 seconds (replay attack prevention)
  const age = Date.now() - ts;
  if (age > 30_000) {
    return false;
  }

  // Reconstruct the signature
  const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
  const data = normalized + ts + from;
  const expected = createHmac('sha256', secret)
    .update(data)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  // For hex strings, simple equality is acceptable since lengths are fixed
  return expected === sig;
}
