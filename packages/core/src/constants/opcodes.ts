/**
 * Flyff SNSP (Server-to-client / client-to-server Packet) opcode constants.
 *
 * These names mirror the original C++ `SNSP_*` constants from the Flyff
 * source to allow easy cross-referencing. Do NOT rename them.
 *
 * @module constants/opcodes
 */

// ---------------------------------------------------------------------------
// SNSP opcode table
// ---------------------------------------------------------------------------

/**
 * Frozen map of all known SNSP opcodes.
 *
 * Values are 16-bit unsigned integers transmitted as the opcode word in
 * every Flyff TCP packet header.
 */
export const SNSP = Object.freeze({
  // ---- Login server -------------------------------------------------------
  /** Client → Login: authenticate with username + MD5 password. */
  LOGIN_CERTIFY:    0xFC03,
  /** Login → Client: server list response. */
  SERVER_LIST:      0xFC06,

  // ---- Cluster server -----------------------------------------------------
  /** Cluster → Client: character list for the account. */
  PLAYER_LIST:      0x7802,
  /** Client → Cluster: create a new character. */
  CREATE_PLAYER:    0x7803,
  /** Client → Cluster: delete a character. */
  DELETE_PLAYER:    0x7804,
  /** Client → Cluster: select a character and enter the world. */
  SELECT_PLAYER:    0xFC15,

  // ---- World server -------------------------------------------------------
  /** Both directions: position / movement snapshot. */
  PLAYER_SNAPSHOOT: 0x7E12,
  /** Both directions: chat message. */
  CHAT:             0xFF00,
  /** Client → World: initiate a melee attack on a target. */
  MELEE_ATTACK:     0x7E2C,

  // ---- Generic / maintenance ----------------------------------------------
  /** Both directions: keep-alive ping. */
  PING:             0xFF08,
  /** Server → Client: generic error code packet. */
  ERROR_CODE:       0xFFFF,
} as const);

/** Union type of all valid SNSP opcode values. */
export type Snsp = typeof SNSP[keyof typeof SNSP];
