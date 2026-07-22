/**
 * Session state machine constants for a connected game client.
 *
 * A client socket progresses through these states in order.  Handlers
 * must gate access to operations on the correct state (e.g. IN_WORLD
 * operations must never be accepted when the client is only AUTHENTICATED).
 *
 * @module constants/sessionState
 */

// ---------------------------------------------------------------------------
// SessionState table
// ---------------------------------------------------------------------------

/**
 * Frozen map of all client session states.
 */
export const SessionState = Object.freeze({
  /** TCP connection established -- client has not yet sent credentials. */
  CONNECTED:     0,
  /** Credentials accepted by the Login server -- session token issued. */
  AUTHENTICATED: 1,
  /** Client has connected to the Cluster server and may select a character. */
  IN_CLUSTER:    2,
  /** Client has entered the world and is actively playing. */
  IN_WORLD:      3,
} as const);

/** Union type of all valid SessionState values. */
export type SessionStateValue = typeof SessionState[keyof typeof SessionState];
