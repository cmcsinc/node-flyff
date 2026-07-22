/**
 * ClusterRegistry -- Login Server side of the Cluster registration handshake.
 *
 * Mirrors `WorldRegistry` (cluster accepts worlds) but for the login->cluster
 * direction. This module:
 *  1. Binds a TCP server on `registration.internalPort` (default 29001)
 *  2. Accepts connections from Cluster Servers
 *  3. Validates REGISTER_CLUSTER: HMAC token + allowlist + duplicate check
 *  4. Sends REGISTER_CLUSTER_ACK
 *  5. Expects periodic CLUSTER_HEARTBEAT -- marks cluster offline on timeout
 *  6. The heartbeat carries live world channel data which enriches the
 *     SNSP_SERVER_LIST packet shown to game clients
 *  7. Emits events so `ServerListService` always has up-to-date state
 *
 * @module login-server/ipc/clusterRegistry
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { IPC_OP } from '@flyff/ipc';
import {
  verifyRegistrationToken,
  RegisterClusterRequestSchema,
  ClusterHeartbeatSchema,
  UnregisterClusterSchema,
  type RegisterClusterRequest,
  type RegisterClusterAck,
  type ClusterHeartbeat,
} from '@flyff/ipc';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single world channel as last reported by the Cluster Server heartbeat. */
export interface WorldChannelInfo {
  readonly channelId: number;
  readonly name: string;
  players: number;
  maxPlayers: number;
  status: 'online' | 'offline' | 'maintenance';
}

/** Live state entry for a registered Cluster Server. */
export interface ClusterEntry {
  readonly serverId: string;
  readonly name: string;
  readonly publicIp: string;
  readonly publicPort: number;
  players: number;
  maxPlayers: number;
  /** Live channel list -- updated every heartbeat. */
  worlds: WorldChannelInfo[];
  status: 'online' | 'offline';
  readonly registeredAt: Date;
  lastHeartbeatMs: number;
  readonly socket: net.Socket;
}

export interface ClusterRegistryDeps {
  serverId: string;
  internalPort: number;
  allowedClusters: readonly string[];
  ipcSecret: string;
  heartbeatTimeoutMs: number;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Protocol framing
// ---------------------------------------------------------------------------

function encodeMessage(opcode: number, payload: unknown): Buffer {
  const body = JSON.stringify({ op: opcode, data: payload });
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(Buffer.byteLength(body, 'utf8'), 0);
  return Buffer.concat([len, Buffer.from(body, 'utf8')]);
}

class FrameParser {
  #buf = Buffer.alloc(0);

  feed(chunk: Buffer): Array<{ op: number; data: unknown }> {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const frames: Array<{ op: number; data: unknown }> = [];

    while (this.#buf.length >= 4) {
      const len = this.#buf.readUInt32BE(0);
      if (this.#buf.length < 4 + len) break;
      const body = this.#buf.subarray(4, 4 + len).toString('utf8');
      this.#buf = this.#buf.subarray(4 + len);
      const parsed: unknown = JSON.parse(body);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'op' in parsed &&
        'data' in parsed
      ) {
        frames.push(parsed as { op: number; data: unknown });
      }
    }

    return frames;
  }
}

// ---------------------------------------------------------------------------
// ClusterRegistry
// ---------------------------------------------------------------------------

/**
 * @fires ClusterRegistry#clusterRegistered   -- (entry: ClusterEntry)
 * @fires ClusterRegistry#clusterUnregistered -- (serverId: string)
 * @fires ClusterRegistry#clusterUpdated      -- (entry: ClusterEntry)
 */
export class ClusterRegistry extends EventEmitter {
  readonly #deps: ClusterRegistryDeps;
  readonly #log: Logger;

  readonly #clusters = new Map<string, ClusterEntry>();
  readonly #socketMap = new Map<net.Socket, string>();

  #server: net.Server | null = null;
  #timeoutCheckTimer: NodeJS.Timeout | null = null;

  constructor(deps: ClusterRegistryDeps) {
    super();
    this.#deps = deps;
    this.#log = deps.logger.child({ component: 'ClusterRegistry', loginId: deps.serverId });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server = net.createServer(socket => this.#onConnection(socket));

      this.#server.on('error', (err: Error) => {
        this.#log.error({ err }, 'ClusterRegistry TCP server error');
        reject(err);
      });

      this.#server.listen(this.#deps.internalPort, '0.0.0.0', () => {
        this.#log.info(
          { port: this.#deps.internalPort },
          'ClusterRegistry TCP server listening for cluster server connections',
        );
        this.#startTimeoutMonitor();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.#timeoutCheckTimer) {
      clearInterval(this.#timeoutCheckTimer);
      this.#timeoutCheckTimer = null;
    }

    for (const [serverId] of this.#clusters) {
      this.#markOffline(serverId, 'Registry stopped');
    }

    await new Promise<void>((resolve, reject) => {
      this.#server?.close(err => (err ? reject(err) : resolve()));
    });
  }

  /** Returns all currently online clusters. Used by ServerListService. */
  getOnlineClusters(): ClusterEntry[] {
    return [...this.#clusters.values()].filter(c => c.status === 'online');
  }

  getCluster(serverId: string): ClusterEntry | null {
    return this.#clusters.get(serverId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Connection handling
  // ---------------------------------------------------------------------------

  #onConnection(socket: net.Socket): void {
    const remoteAddr = `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`;
    this.#log.debug({ remoteAddr }, 'Incoming connection from potential cluster server');

    const parser = new FrameParser();
    let registeredServerId: string | null = null;

    socket.on('data', (chunk: Buffer) => {
      const frames = parser.feed(chunk);
      for (const frame of frames) {
        registeredServerId = this.#dispatch(frame.op, frame.data, socket, registeredServerId);
      }
    });

    socket.on('close', () => {
      const serverId = this.#socketMap.get(socket) ?? registeredServerId;
      if (serverId) {
        this.#log.warn({ serverId }, 'Cluster Server socket closed -- marking offline');
        this.#markOffline(serverId, 'TCP connection closed');
        this.#socketMap.delete(socket);
      }
    });

    socket.on('error', (err: Error) => {
      const serverId = this.#socketMap.get(socket) ?? registeredServerId ?? 'unknown';
      this.#log.error({ err, serverId }, 'Cluster Server socket error');
    });
  }

  // ---------------------------------------------------------------------------
  // Frame dispatch
  // ---------------------------------------------------------------------------

  #dispatch(
    op: number,
    data: unknown,
    socket: net.Socket,
    currentServerId: string | null,
  ): string | null {
    switch (op) {
      case IPC_OP.REGISTER_CLUSTER:
        return this.#handleRegister(data, socket);

      case IPC_OP.CLUSTER_HEARTBEAT:
        this.#handleHeartbeat(data, socket);
        return currentServerId;

      case IPC_OP.UNREGISTER_CLUSTER: {
        const result = UnregisterClusterSchema.safeParse(data);
        if (result.success) {
          this.#log.info(
            { serverId: result.data.serverId, reason: result.data.reason },
            'Cluster Server sent graceful UNREGISTER_CLUSTER',
          );
          this.#markOffline(result.data.serverId, result.data.reason ?? 'Graceful shutdown');
          this.#socketMap.delete(socket);
          socket.destroy();
        }
        return null;
      }

      default:
        this.#log.warn({ op }, 'Received unknown IPC opcode from Cluster Server');
        return currentServerId;
    }
  }

  // ---------------------------------------------------------------------------
  // Registration validation
  // ---------------------------------------------------------------------------

  #handleRegister(data: unknown, socket: net.Socket): string | null {
    const result = RegisterClusterRequestSchema.safeParse(data);

    if (!result.success) {
      this.#reject(socket, 'Malformed REGISTER_CLUSTER payload');
      return null;
    }

    const req: RegisterClusterRequest = result.data;

    // 1. Allowlist check
    if (!this.#deps.allowedClusters.includes(req.serverId)) {
      this.#log.warn({ serverId: req.serverId }, 'REGISTER_CLUSTER rejected: not in allowedClusters');
      this.#reject(socket, `Server ID "${req.serverId}" is not in the allowed clusters list`);
      return null;
    }

    // 2. Duplicate registration check
    const existing = this.#clusters.get(req.serverId);
    if (existing && existing.status === 'online') {
      this.#log.warn({ serverId: req.serverId }, 'REGISTER_CLUSTER rejected: already registered');
      this.#reject(socket, `Server ID "${req.serverId}" is already registered`);
      return null;
    }

    // 3. HMAC token verification -- timing-safe
    const tokenValid = verifyRegistrationToken(
      this.#deps.ipcSecret,
      req.serverId,
      'cluster',
      req.registrationToken,
    );
    if (!tokenValid) {
      this.#log.warn({ serverId: req.serverId }, 'REGISTER_CLUSTER rejected: invalid token');
      this.#reject(socket, 'Invalid registration token');
      return null;
    }

    // All checks passed
    const entry: ClusterEntry = {
      serverId: req.serverId,
      name: req.name,
      publicIp: req.publicIp,
      publicPort: req.publicPort,
      players: req.players,
      maxPlayers: req.maxPlayers,
      worlds: req.worlds,
      status: 'online',
      registeredAt: new Date(),
      lastHeartbeatMs: Date.now(),
      socket,
    };

    this.#clusters.set(req.serverId, entry);
    this.#socketMap.set(socket, req.serverId);

    this.#log.info(
      { serverId: req.serverId, name: req.name, players: req.players },
      'Cluster Server registered successfully',
    );

    const ack: RegisterClusterAck = { success: true };
    socket.write(encodeMessage(IPC_OP.REGISTER_CLUSTER_ACK, ack));

    this.emit('clusterRegistered', entry);
    return req.serverId;
  }

  // ---------------------------------------------------------------------------
  // Heartbeat handling
  // ---------------------------------------------------------------------------

  #handleHeartbeat(data: unknown, socket: net.Socket): void {
    const result = ClusterHeartbeatSchema.safeParse(data);
    if (!result.success) {
      this.#log.warn({ errors: result.error.errors }, 'Malformed CLUSTER_HEARTBEAT');
      return;
    }

    const hb: ClusterHeartbeat = result.data;
    const entry = this.#clusters.get(hb.serverId);

    if (!entry) {
      this.#log.warn({ serverId: hb.serverId }, 'CLUSTER_HEARTBEAT from unregistered cluster');
      return;
    }

    // Update live state
    entry.worlds = hb.worlds.map(w => ({ ...w }));
    entry.players = hb.worlds.reduce((sum, w) => sum + w.players, 0);
    entry.lastHeartbeatMs = Date.now();
    entry.status = 'online';

    // Send ACK
    socket.write(encodeMessage(IPC_OP.CLUSTER_HEARTBEAT_ACK, { ts: hb.ts }));

    this.emit('clusterUpdated', entry);
  }

  // ---------------------------------------------------------------------------
  // Offline detection
  // ---------------------------------------------------------------------------

  #markOffline(serverId: string, reason: string): void {
    const entry = this.#clusters.get(serverId);
    if (!entry || entry.status === 'offline') return;

    entry.status = 'offline';
    this.#log.warn({ serverId, reason }, 'Cluster Server marked offline');
    this.emit('clusterUnregistered', serverId);
    this.#clusters.delete(serverId);
  }

  #startTimeoutMonitor(): void {
    this.#timeoutCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const [serverId, entry] of this.#clusters) {
        if (entry.status !== 'online') continue;
        const elapsed = now - entry.lastHeartbeatMs;
        if (elapsed > this.#deps.heartbeatTimeoutMs) {
          this.#log.warn(
            { serverId, elapsedMs: elapsed },
            'Cluster Server heartbeat timeout -- marking offline',
          );
          entry.socket.destroy();
          this.#markOffline(serverId, 'Heartbeat timeout');
        }
      }
    }, Math.floor(this.#deps.heartbeatTimeoutMs / 2));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  #reject(socket: net.Socket, reason: string): void {
    this.#log.warn({ reason }, 'Sending REGISTER_CLUSTER_ACK rejection');
    const ack: RegisterClusterAck = { success: false, reason };
    try {
      socket.write(encodeMessage(IPC_OP.REGISTER_CLUSTER_ACK, ack));
    } catch {
      // Socket may already be closing
    }
    socket.destroy();
  }
}
