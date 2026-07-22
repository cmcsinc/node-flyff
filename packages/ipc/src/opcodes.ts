/**
 * Internal IPC opcode constants for server-to-server communication.
 *
 * These are **not** Flyff SNSP client-facing opcodes. They are emulator-internal
 * operation codes used by `IpcServer` / `IpcClient` TCP request-response pairs.
 * They mirror the role of `SNSP_CERTIFY` / `SNSP_JOINWORLD` etc. from the original
 * Flyff C++ CacheServer / CDPCoreSrvr architecture, but live on a private internal
 * TCP socket secured by HMAC-SHA256 signing (not on the public game port).
 *
 * Numbering convention:
 *   0x0001-0x000F  World <-> Cluster registration & heartbeat
 *   0x0010-0x001F  Cluster <-> Login registration & heartbeat
 *   0x0020-0x002F  Cluster <-> World player handoff
 *   0x0030-0x003F  Broadcast / monitoring
 *
 * @module ipc/opcodes
 */

/**
 * Internal IPC operation codes.
 *
 * @example
 * ```ts
 * import { IPC_OP } from '@flyff/ipc';
 *
 * ipcServer.handle(IPC_OP.REGISTER_WORLD, async (payload) => { ... });
 * const ack = await ipcClient.request(IPC_OP.REGISTER_WORLD, registrationPayload);
 * ```
 */
export const IPC_OP = Object.freeze({
  // -------------------------------------------------------------------------
  // World <-> Cluster  (0x0001 - 0x000F)
  // -------------------------------------------------------------------------

  /** World -> Cluster: initial registration request on startup. */
  REGISTER_WORLD: 0x0001,

  /** Cluster -> World: ACK for REGISTER_WORLD (success or rejection reason). */
  REGISTER_WORLD_ACK: 0x0002,

  /** World -> Cluster: periodic keep-alive ping (every 5 s). */
  WORLD_HEARTBEAT: 0x0003,

  /** Cluster -> World: ACK for WORLD_HEARTBEAT. */
  WORLD_HEARTBEAT_ACK: 0x0004,

  /** World -> Cluster: graceful shutdown notice before disconnecting. */
  UNREGISTER_WORLD: 0x0005,

  // -------------------------------------------------------------------------
  // Cluster <-> Login  (0x0010 - 0x001F)
  // -------------------------------------------------------------------------

  /** Cluster -> Login: initial registration request on startup. */
  REGISTER_CLUSTER: 0x0010,

  /** Login -> Cluster: ACK for REGISTER_CLUSTER. */
  REGISTER_CLUSTER_ACK: 0x0011,

  /** Cluster -> Login: periodic keep-alive ping (every 5 s). */
  CLUSTER_HEARTBEAT: 0x0012,

  /** Login -> Cluster: ACK for CLUSTER_HEARTBEAT. */
  CLUSTER_HEARTBEAT_ACK: 0x0013,

  /** Cluster -> Login: graceful shutdown notice. */
  UNREGISTER_CLUSTER: 0x0014,

  // -------------------------------------------------------------------------
  // Cluster <-> World -- Player Handoff  (0x0020 - 0x002F)
  // -------------------------------------------------------------------------

  /** Cluster -> World: player is entering this world channel. */
  PLAYER_ENTER_WORLD: 0x0020,

  /** World -> Cluster: player successfully entered. */
  PLAYER_ENTER_WORLD_ACK: 0x0021,

  /** World -> Cluster: player left the world (disconnect or map change). */
  PLAYER_LEFT_WORLD: 0x0022,

  // -------------------------------------------------------------------------
  // Broadcast / Monitoring  (0x0030 - 0x003F)
  // -------------------------------------------------------------------------

  /** Any server -> All: generic status update. */
  SERVER_STATUS_UPDATE: 0x0030,

  /** Any server -> All: server is entering maintenance mode. */
  SERVER_MAINTENANCE: 0x0031,
} as const);

/** Union type of all valid IPC opcode values. */
export type IpcOpcode = (typeof IPC_OP)[keyof typeof IPC_OP];
