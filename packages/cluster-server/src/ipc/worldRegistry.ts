/**
 * WorldRegistry — Cluster Server side of the World registration handshake.
 *
 * This module:
 *  1. Binds a TCP server on `registration.internalPort`
 *  2. Accepts connections from World Servers
 *  3. Validates REGISTER_WORLD: HMAC token + allowlist + duplicate check
 *  4. Sends REGISTER_WORLD_ACK (success or rejection with reason)
 *  5. Expects periodic WORLD_HEARTBEAT — marks world offline on timeout
 *  6. Emits events so the LoginRegistrar can push updated counts to Login
 *  7. Handles UNREGISTER_WORLD for graceful shutdown
 *  8. Detects TCP socket close immediately (no TTL gap vs Redis approach)
 *
 * The in-memory `WorldEntry` map is the authoritative live state for
 * "which worlds are online" — used by `WorldListService` to serve
 * character-select and player-handoff requests.
 *
 * @module cluster-server/ipc/worldRegistry
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { IPC_OP } from '@flyff/ipc';
import {
  verifyRegistrationToken,
  RegisterWorldRequestSchema,
  WorldHeartbeatSchema,
  UnregisterWorldSchema,
  type RegisterWorldRequest,
  type RegisterWorldAck,
  type WorldHeartbeat,
} from '@flyff/ipc';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorldEntry {
  /** Server ID as reported in REGISTER_WORLD (matches config allowedWorlds). */
  readonly serverId: string;
  /** Display name for channel selector. */
  readonly name: string;
  /** Public IPv4 address clients connect to for gameplay. */
  readonly publicIp: string;
  /** Public TCP port clients connect to. */
  readonly publicPort: number;
  /** Maximum player capacity. */
  readonly maxPlayers: number;
  /** Channel index within this cluster (1-based). */
  readonly channelId: number;
  /** Current online player count — updated via heartbeat. */
  players: number;
  /** Online/offline state. */
  status: 'online' | 'offline';
  /** When this world registered. */
  readonly registeredAt: Date;
  /** Unix ms of the last received heartbeat. */
  lastHeartbeatMs: number;
  /** The raw TCP socket — close event = immediate offline detection. */
  readonly socket: net.Socket;
}

export interface WorldRegistryDeps {
  /** Cluster Server's own ID (used in log context). */
  serverId: string;
  /** Internal TCP port to bind. */
  internalPort: number;
  /** Allowlist of world server IDs. Empty = accept none. */
  allowedWorlds: readonly string[];
  /** IPC secret used to verify registration tokens. */
  ipcSecret: string;
  /** How long (ms) without a heartbeat before a world is considered dead. */
  heartbeatTimeoutMs: number;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Protocol framing (same length-prefix scheme as ClusterRegistrar)
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
// WorldRegistry
// ---------------------------------------------------------------------------

/**
 * @fires WorldRegistry#worldRegistered   — when a world is accepted: (entry: WorldEntry)
 * @fires WorldRegistry#worldUnregistered — when a world goes offline: (serverId: string)
 * @fires WorldRegistry#worldUpdated      — when heartbeat updates player count: (entry: WorldEntry)
 */
export class WorldRegistry extends EventEmitter {
  readonly #deps: WorldRegistryDeps;
  readonly #log: Logger;

  /** serverId → WorldEntry for all currently registered worlds. */
  readonly #worlds = new Map<string, WorldEntry>();

  /** socket → serverId mapping for fast close-event lookup. */
  readonly #socketMap = new Map<net.Socket, string>();

  #server: net.Server | null = null;
  #timeoutCheckTimer: NodeJS.Timeout | null = null;

  constructor(deps: WorldRegistryDeps) {
    super();
    this.#deps = deps;
    this.#log = deps.logger.child({ component: 'WorldRegistry', clusterId: deps.serverId });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Starts the internal TCP server and the heartbeat timeout monitor.
   * Call once on Cluster Server startup, before accepting game clients.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server = net.createServer(socket => this.#onConnection(socket));

      this.#server.on('error', (err: Error) => {
        this.#log.error({ err }, 'WorldRegistry TCP server error');
        reject(err);
      });

      this.#server.listen(this.#deps.internalPort, '0.0.0.0', () => {
        this.#log.info(
          { port: this.#deps.internalPort },
          'WorldRegistry TCP server listening for world server connections',
        );
        this.#startTimeoutMonitor();
        resolve();
      });
    });
  }

  /** Stops the server and marks all worlds offline. */
  async stop(): Promise<void> {
    if (this.#timeoutCheckTimer) {
      clearInterval(this.#timeoutCheckTimer);
      this.#timeoutCheckTimer = null;
    }

    for (const [serverId] of this.#worlds) {
      this.#markOffline(serverId, 'Registry stopped');
    }

    await new Promise<void>((resolve, reject) => {
      this.#server?.close(err => (err ? reject(err) : resolve()));
    });
  }

  /** Returns a snapshot of all currently online worlds. */
  getOnlineWorlds(): WorldEntry[] {
    return [...this.#worlds.values()].filter(w => w.status === 'online');
  }

  /** Returns a specific world by ID, or null. */
  getWorld(serverId: string): WorldEntry | null {
    return this.#worlds.get(serverId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Connection handling
  // ---------------------------------------------------------------------------

  #onConnection(socket: net.Socket): void {
    const remoteAddr = `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`;
    this.#log.debug({ remoteAddr }, 'Incoming connection from potential world server');

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
        this.#log.warn({ serverId }, 'World Server socket closed — marking offline');
        this.#markOffline(serverId, 'TCP connection closed');
        this.#socketMap.delete(socket);
      } else {
        this.#log.debug({ remoteAddr }, 'Unregistered connection closed');
      }
    });

    socket.on('error', (err: Error) => {
      const serverId = this.#socketMap.get(socket) ?? registeredServerId ?? 'unknown';
      this.#log.error({ err, serverId }, 'World Server socket error');
    });
  }

  // ---------------------------------------------------------------------------
  // Frame dispatch
  // ---------------------------------------------------------------------------

  /**
   * Handles a single decoded frame from a world server connection.
   * Returns the registered serverId (may be newly set after REGISTER_WORLD).
   */
  #dispatch(
    op: number,
    data: unknown,
    socket: net.Socket,
    currentServerId: string | null,
  ): string | null {
    switch (op) {
      case IPC_OP.REGISTER_WORLD:
        return this.#handleRegister(data, socket);

      case IPC_OP.WORLD_HEARTBEAT:
        this.#handleHeartbeat(data, socket);
        return currentServerId;

      case IPC_OP.UNREGISTER_WORLD: {
        const result = UnregisterWorldSchema.safeParse(data);
        if (result.success) {
          this.#log.info(
            { serverId: result.data.serverId, reason: result.data.reason },
            'World Server sent graceful UNREGISTER_WORLD',
          );
          this.#markOffline(result.data.serverId, result.data.reason ?? 'Graceful shutdown');
          this.#socketMap.delete(socket);
          socket.destroy();
        }
        return null;
      }

      default:
        this.#log.warn({ op }, 'Received unknown IPC opcode from World Server');
        return currentServerId;
    }
  }

  // ---------------------------------------------------------------------------
  // Registration validation
  // ---------------------------------------------------------------------------

  #handleRegister(data: unknown, socket: net.Socket): string | null {
    const result = RegisterWorldRequestSchema.safeParse(data);

    if (!result.success) {
      this.#reject(socket, 'Malformed REGISTER_WORLD payload');
      return null;
    }

    const req: RegisterWorldRequest = result.data;

    // 1. Allowlist check
    if (!this.#deps.allowedWorlds.includes(req.serverId)) {
      this.#log.warn(
        { serverId: req.serverId },
        'REGISTER_WORLD rejected: serverId not in allowedWorlds',
      );
      this.#reject(socket, `Server ID "${req.serverId}" is not in the allowed worlds list`);
      return null;
    }

    // 2. Duplicate registration check
    const existing = this.#worlds.get(req.serverId);
    if (existing && existing.status === 'online') {
      this.#log.warn(
        { serverId: req.serverId },
        'REGISTER_WORLD rejected: world already registered (duplicate)',
      );
      this.#reject(socket, `Server ID "${req.serverId}" is already registered`);
      return null;
    }

    // 3. HMAC token verification — timing-safe
    const tokenValid = verifyRegistrationToken(
      this.#deps.ipcSecret,
      req.serverId,
      'world',
      req.registrationToken,
    );
    if (!tokenValid) {
      this.#log.warn(
        { serverId: req.serverId },
        'REGISTER_WORLD rejected: invalid registration token',
      );
      this.#reject(socket, 'Invalid registration token');
      return null;
    }

    // All checks passed — register the world
    const channelIndex = req.channelId - 1; // 0-based
    const entry: WorldEntry = {
      serverId: req.serverId,
      name: req.name,
      publicIp: req.publicIp,
      publicPort: req.publicPort,
      maxPlayers: req.maxPlayers,
      channelId: req.channelId,
      players: 0,
      status: 'online',
      registeredAt: new Date(),
      lastHeartbeatMs: Date.now(),
      socket,
    };

    this.#worlds.set(req.serverId, entry);
    this.#socketMap.set(socket, req.serverId);

    this.#log.info(
      { serverId: req.serverId, name: req.name, channelId: req.channelId },
      'World Server registered successfully',
    );

    // Send ACK
    const ack: RegisterWorldAck = { success: true, channelIndex };
    socket.write(encodeMessage(IPC_OP.REGISTER_WORLD_ACK, ack));

    this.emit('worldRegistered', entry);
    return req.serverId;
  }

  // ---------------------------------------------------------------------------
  // Heartbeat handling
  // ---------------------------------------------------------------------------

  #handleHeartbeat(data: unknown, socket: net.Socket): void {
    const result = WorldHeartbeatSchema.safeParse(data);
    if (!result.success) {
      this.#log.warn({ errors: result.error.errors }, 'Malformed WORLD_HEARTBEAT');
      return;
    }

    const hb: WorldHeartbeat = result.data;
    const entry = this.#worlds.get(hb.serverId);

    if (!entry) {
      this.#log.warn({ serverId: hb.serverId }, 'WORLD_HEARTBEAT from unregistered world — ignoring');
      return;
    }

    entry.players = hb.players;
    entry.lastHeartbeatMs = Date.now();
    entry.status = 'online';

    // Send ACK
    socket.write(encodeMessage(IPC_OP.WORLD_HEARTBEAT_ACK, { ts: hb.ts }));

    this.emit('worldUpdated', entry);
  }

  // ---------------------------------------------------------------------------
  // Offline detection
  // ---------------------------------------------------------------------------

  #markOffline(serverId: string, reason: string): void {
    const entry = this.#worlds.get(serverId);
    if (!entry) return;

    if (entry.status === 'offline') return; // Already offline

    entry.status = 'offline';
    this.#log.warn({ serverId, reason }, 'World Server marked offline');
    this.emit('worldUnregistered', serverId);

    // Remove from live map — they must re-register on reconnect
    this.#worlds.delete(serverId);
  }

  /**
   * Periodically check all registered worlds for heartbeat timeout.
   * This is a belt-and-suspenders guard — the TCP 'close' event handles
   * most cases, but silent network drops can delay the close event.
   */
  #startTimeoutMonitor(): void {
    this.#timeoutCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const [serverId, entry] of this.#worlds) {
        if (entry.status !== 'online') continue;
        const elapsed = now - entry.lastHeartbeatMs;
        if (elapsed > this.#deps.heartbeatTimeoutMs) {
          this.#log.warn(
            { serverId, elapsedMs: elapsed, timeoutMs: this.#deps.heartbeatTimeoutMs },
            'World Server heartbeat timeout — marking offline',
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
    this.#log.warn({ reason }, 'Sending REGISTER_WORLD_ACK rejection');
    const ack: RegisterWorldAck = { success: false, reason };
    try {
      socket.write(encodeMessage(IPC_OP.REGISTER_WORLD_ACK, ack));
    } catch {
      // Socket may already be closing
    }
    socket.destroy();
  }
}
