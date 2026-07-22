/**
 * Registration token utilities for server-to-server authentication.
 *
 * Mirrors the role of the shared key (`SNSP_CERTIFY` payload in C++ Flyff) but
 * uses HMAC-SHA256 instead of a plaintext password. Both the registering server
 * and the receiving server independently compute the same token -- the registering
 * server sends it, the receiver verifies it with `timingSafeEqual` to prevent
 * timing-attack-based forgery.
 *
 * ## Why not a separate secret?
 * The `IPC_SECRET` already protects all IPC messages via HMAC signing. Adding a
 * second secret would only provide real value if `IPC_SECRET` were compromised but
 * the second secret were not -- an unlikely split scenario. Instead, we derive a
 * *purpose-scoped* token: `HMAC(IPC_SECRET, "registration:<serverId>:<serverType>")`.
 * This ensures the registration token is different from every other HMAC in the
 * system, and cannot be reused across server types.
 *
 * @module ipc/registration
 */

import crypto from 'node:crypto';

/** Server type identifiers used in token derivation. */
export type ServerType = 'world' | 'cluster' | 'login';

/**
 * Derives the registration token for a given server.
 *
 * The token is `HMAC-SHA256(ipcSecret, "registration:<serverId>:<serverType>")`
 * encoded as a lowercase hex string.
 *
 * Both sides (registrar and registry) call this function independently with the
 * same `ipcSecret` from their environment -- they must match or registration is
 * rejected.
 *
 * @param ipcSecret - The shared `IPC_SECRET` value from environment / config.
 * @param serverId  - The server's unique ID (e.g. `"world_1"`).
 * @param serverType - The type of server registering (prevents cross-type replay).
 * @returns A 64-character lowercase hex string.
 *
 * @example
 * ```ts
 * const token = computeRegistrationToken(config.ipc.secret, 'world_1', 'world');
 * // token === 'a3f9...e0' (64 hex chars)
 * ```
 */
export function computeRegistrationToken(
  ipcSecret: string,
  serverId: string,
  serverType: ServerType,
): string {
  return crypto
    .createHmac('sha256', ipcSecret)
    .update(`registration:${serverId}:${serverType}`)
    .digest('hex');
}

/**
 * Verifies a registration token using a constant-time comparison to prevent
 * timing attacks.
 *
 * @param ipcSecret      - The shared `IPC_SECRET` value.
 * @param serverId       - The server ID claimed by the registering server.
 * @param serverType     - The server type claimed by the registering server.
 * @param receivedToken  - The token received from the registering server.
 * @returns `true` if the token is valid.
 *
 * @example
 * ```ts
 * const valid = verifyRegistrationToken(
 *   config.ipc.secret,
 *   payload.serverId,
 *   'world',
 *   payload.registrationToken,
 * );
 * if (!valid) throw new AuthError('Invalid registration token');
 * ```
 */
export function verifyRegistrationToken(
  ipcSecret: string,
  serverId: string,
  serverType: ServerType,
  receivedToken: string,
): boolean {
  const expected = computeRegistrationToken(ipcSecret, serverId, serverType);

  // Ensure both buffers have the same byte length before comparing --
  // timingSafeEqual throws if lengths differ, which would leak info.
  if (expected.length !== receivedToken.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(receivedToken, 'utf8'),
  );
}
