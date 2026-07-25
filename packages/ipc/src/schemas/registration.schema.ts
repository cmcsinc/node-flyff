/**
 * Zod schemas for all server-to-server registration and heartbeat IPC messages.
 *
 * These schemas validate every payload exchanged over the internal `IpcServer` /
 * `IpcClient` TCP connection during the registration handshake. They mirror the
 * data structures from the original Flyff C++ `SNSP_CERTIFY` / `SNSP_UPDATESERVERINFO`
 * packets but are validated at runtime with Zod instead of being trusted binary structs.
 *
 * @module ipc/schemas/registration
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// World -> Cluster registration
// ---------------------------------------------------------------------------

/**
 * Payload sent by a World Server when it connects to the Cluster Server's
 * internal IpcServer port. Mirrors `SNSP_CERTIFY` + server metadata from C++.
 */
export const RegisterWorldRequestSchema = z.object({
  /** Unique server identifier -- must match an entry in cluster's allowedWorlds list. */
  serverId: z.string().min(1).max(64),
  /** Human-readable display name shown in the channel selector. */
  name: z.string().min(1).max(64),
  /** Public IPv4 address clients connect to for gameplay. */
  publicIp: z.string().ip({ version: 'v4' }),
  /** Public TCP port clients connect to (default: 38180). */
  publicPort: z.number().int().min(1024).max(65535),
  /** Maximum simultaneous player connections this world supports. */
  maxPlayers: z.number().int().min(1),
  /** Channel index within the cluster (1-based, e.g. "Madrigal Ch.1" = 1). */
  channelId: z.number().int().min(1),
  /**
   * HMAC-derived registration token.
   * Computed as: HMAC-SHA256(IPC_SECRET, "registration:<serverId>:world")
   * Verified server-side with timingSafeEqual.
   */
  registrationToken: z.string().length(64),
});
export type RegisterWorldRequest = z.infer<typeof RegisterWorldRequestSchema>;

/**
 * ACK sent by the Cluster Server after validating a REGISTER_WORLD request.
 * If `success` is false, `reason` explains why (for server logs -- never shown to players).
 */
export const RegisterWorldAckSchema = z.object({
  success: z.boolean(),
  /** Assigned 0-based channel index within the cluster's channel list. */
  channelIndex: z.number().int().min(0).optional(),
  /** Human-readable rejection reason (only present when success = false). */
  reason: z.string().optional(),
});
export type RegisterWorldAck = z.infer<typeof RegisterWorldAckSchema>;

// ---------------------------------------------------------------------------
// World -> Cluster heartbeat
// ---------------------------------------------------------------------------

/**
 * Periodic keep-alive payload sent by the World Server to the Cluster Server
 * every `heartbeatIntervalMs` milliseconds. Also carries live player count.
 */
export const WorldHeartbeatSchema = z.object({
  serverId: z.string().min(1),
  /** Current number of players connected to this world channel. */
  players: z.number().int().min(0),
  /** Unix timestamp (ms) at the time of sending. */
  ts: z.number().int(),
});
export type WorldHeartbeat = z.infer<typeof WorldHeartbeatSchema>;

/** ACK sent by the Cluster Server in response to a WORLD_HEARTBEAT. */
export const WorldHeartbeatAckSchema = z.object({
  ts: z.number().int(),
});
export type WorldHeartbeatAck = z.infer<typeof WorldHeartbeatAckSchema>;

// ---------------------------------------------------------------------------
// World -> Cluster graceful shutdown
// ---------------------------------------------------------------------------

/** Sent by the World Server before intentional shutdown so the Cluster can react instantly. */
export const UnregisterWorldSchema = z.object({
  serverId: z.string().min(1),
  /** Human-readable shutdown reason for operator logs. */
  reason: z.string().optional(),
});
export type UnregisterWorld = z.infer<typeof UnregisterWorldSchema>;

// ---------------------------------------------------------------------------
// Cluster -> Login registration
// ---------------------------------------------------------------------------

/**
 * One world channel entry, shared between {@link RegisterClusterRequestSchema}
 * and {@link ClusterHeartbeatSchema}. Sent at registration so the Login Server
 * can populate the server list immediately instead of waiting for the first
 * heartbeat (the v19 client cannot proceed past server-select without a channel).
 */
export const WorldChannelSchema = z.object({
  channelId: z.number().int().min(1),
  name: z.string().min(1),
  players: z.number().int().min(0),
  maxPlayers: z.number().int().min(1),
  status: z.enum(['online', 'offline', 'maintenance']),
});
export type WorldChannel = z.infer<typeof WorldChannelSchema>;

/**
 * Payload sent by a Cluster Server when it connects to the Login Server's
 * internal IpcServer port. Provides the data needed to build the SNSP_SERVER_LIST
 * packet sent to game clients.
 */
export const RegisterClusterRequestSchema = z.object({
  serverId: z.string().min(1).max(64),
  /** Display name shown in the login server-selection screen. */
  name: z.string().min(1).max(64),
  /** Public IP clients connect to for character selection. */
  publicIp: z.string().ip({ version: 'v4' }),
  /** Public port of the cluster server (PN_LOGINSRVR = 28000). */
  publicPort: z.number().int().min(1024).max(65535),
  /** Number of world channels currently online under this cluster. */
  channelCount: z.number().int().min(0),
  /**
   * World channels currently online under this cluster. Sent at registration so
   * the Login Server's server list has channel children immediately -- the v19
   * client requires a server + a channel to proceed past server-select.
   */
  worlds: z.array(WorldChannelSchema).default([]),
  /** Total players across all world channels. */
  players: z.number().int().min(0),
  /** Maximum players across all world channels. */
  maxPlayers: z.number().int().min(1),
  /**
   * HMAC-derived registration token.
   * Computed as: HMAC-SHA256(IPC_SECRET, "registration:<serverId>:cluster")
   */
  registrationToken: z.string().length(64),
});
export type RegisterClusterRequest = z.infer<typeof RegisterClusterRequestSchema>;

/**
 * ACK sent by the Login Server after validating a REGISTER_CLUSTER request.
 */
export const RegisterClusterAckSchema = z.object({
  success: z.boolean(),
  reason: z.string().optional(),
});
export type RegisterClusterAck = z.infer<typeof RegisterClusterAckSchema>;

// ---------------------------------------------------------------------------
// Cluster -> Login heartbeat
// ---------------------------------------------------------------------------

/**
 * Periodic keep-alive sent by the Cluster Server to the Login Server.
 * Carries up-to-date player counts so the Login Server can show accurate
 * player numbers in the server list.
 */
export const ClusterHeartbeatSchema = z.object({
  serverId: z.string().min(1),
  /** Worlds currently online under this cluster (live list). */
  worlds: z.array(WorldChannelSchema),
  ts: z.number().int(),
});
export type ClusterHeartbeat = z.infer<typeof ClusterHeartbeatSchema>;

/** ACK for CLUSTER_HEARTBEAT. */
export const ClusterHeartbeatAckSchema = z.object({
  ts: z.number().int(),
});
export type ClusterHeartbeatAck = z.infer<typeof ClusterHeartbeatAckSchema>;

// ---------------------------------------------------------------------------
// Cluster -> Login graceful shutdown
// ---------------------------------------------------------------------------

export const UnregisterClusterSchema = z.object({
  serverId: z.string().min(1),
  reason: z.string().optional(),
});
export type UnregisterCluster = z.infer<typeof UnregisterClusterSchema>;

// ---------------------------------------------------------------------------
// Cluster -> World player handoff
// ---------------------------------------------------------------------------

/**
 * Sent by the Cluster Server to the World Server when a client has selected a
 * character and should be allowed to enter the world. Mirrors `SNSP_JOINWORLD` / player
 * session transfer from the original C++ CacheServer architecture.
 */
export const PlayerEnterWorldSchema = z.object({
  /** Single-use token the client presents to the World Server on TCP connect. */
  sessionToken: z.string().uuid(),
  accountId: z.number().int().positive(),
  characterId: z.number().int().positive(),
  /** Unix timestamp (ms) the token was issued -- world rejects if > tokenTtlMs old. */
  issuedAt: z.number().int(),
});
export type PlayerEnterWorld = z.infer<typeof PlayerEnterWorldSchema>;

/** ACK sent by the World Server after accepting the player handoff. */
export const PlayerEnterWorldAckSchema = z.object({
  accepted: z.boolean(),
  reason: z.string().optional(),
});
export type PlayerEnterWorldAck = z.infer<typeof PlayerEnterWorldAckSchema>;
