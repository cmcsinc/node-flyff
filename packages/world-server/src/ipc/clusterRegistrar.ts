/**
 * ClusterRegistrar -- World Server side of the registration handshake.
 *
 * On startup this module:
 *  1. TCP-connects to the Cluster Server's internal IpcServer port
 *  2. Sends REGISTER_WORLD with a HMAC-derived registration token
 *  3. Waits for REGISTER_WORLD_ACK -- aborts if rejected
 *  4. Drives a periodic WORLD_HEARTBEAT to keep the slot alive
 *  5. Auto-reconnects with exponential backoff if the connection drops
 *  6. Sends UNREGISTER_WORLD before intentional shutdown
 *
 * Mirrors the `CDPCoreSrvr`-based handshake from the original Flyff C++
 * WorldServer, replacing `SNSP_CERTIFY` with HMAC-token + IPC_OP codes.
 *
 * @module world-server/ipc/clusterRegistrar
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { IPC_OP } from '@flyff/ipc';
import {
  computeRegistrationToken,
  type RegisterWorldRequest,
  type RegisterWorldAck,
  RegisterWorldAckSchema,
  WorldHeartbeatAckSchema,
} from '@flyff/ipc';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClusterRegistrarDeps {
  /** The world server's own config (id, name, public ip/port, etc.). */
  serverId: string;
  channelId: number;
  channelName: string;
  publicIp: string;
  publicPort: number;
  maxPlayers: number;
  /** IPC shared secret -- used to derive the registration token. */
  ipcSecret: string;
  /** Cluster server internal connection details. */
  clusterHost: string;
  clusterInternalPort: number;
  /** Milliseconds between reconnect attempts. */
  reconnectIntervalMs: number;
  /** Milliseconds between heartbeat pings. */
  heartbeatIntervalMs: number;
  /** Live player count callback -- called each heartbeat to get current count. */
  getPlayerCount: () => number;
  logger: Logger;
}

export type RegistrarEvent = 'registered' | 'unregistered' | 'reconnecting';

// ---------------------------------------------------------------------------
// Protocol framing
// ---------------------------------------------------------------------------

/** Encodes an IPC message as length-prefixed JSON for the wire. */
function encodeMessage(opcode: number, payload: unknown): Buffer {
  const body = JSON.stringify({ op: opcode, data: payload });
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(Buffer.byteLength(body, 'utf8'), 0);
  return Buffer.concat([len, Buffer.from(body, 'utf8')]);
}

/**
 * Minimal incremental frame parser.
 * Reads 4-byte big-endian length prefix then that many bytes of JSON body.
 */
class FrameParser {
  #buf = Buffer.alloc(0);

  feed(chunk: Buffer): { op: number; data: unknown }[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const frames: { op: number; data: unknown }[] = [];

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
// ClusterRegistrar
// ---------------------------------------------------------------------------

/**
 * Manages the World Server's persistent connection to the Cluster Server.
 *
 * @fires ClusterRegistrar#registered  -- when registration is accepted
 * @fires ClusterRegistrar#unregistered -- when gracefully unregistered or connection lost
 * @fires ClusterRegistrar#reconnecting -- when starting a reconnect attempt
 */
export class ClusterRegistrar extends EventEmitter {
  readonly #deps: ClusterRegistrarDeps;
  readonly #log: Logger;

  #socket: net.Socket | null = null;
  #parser: FrameParser = new FrameParser();
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #reconnectAttempts = 0;
  #registered = false;
  #destroyed = false;

  constructor(deps: ClusterRegistrarDeps) {
    super();
    this.#deps = deps;
    this.#log = deps.logger.child({ component: 'ClusterRegistrar' });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Begin connecting to the Cluster Server. Call once on server startup. */
  start(): void {
    if (this.#destroyed) throw new Error('ClusterRegistrar has been destroyed');
    this.#connect();
  }

  /**
   * Gracefully unregisters from the Cluster Server and closes the connection.
   * Call before process shutdown.
   */
  async shutdown(reason = 'Server shutting down'): Promise<void> {
    this.#destroyed = true;
    this.#clearTimers();

    if (this.#socket && !this.#socket.destroyed && this.#registered) {
      this.#send(IPC_OP.UNREGISTER_WORLD, {
        serverId: this.#deps.serverId,
        reason,
      });
      // Give the packet a moment to flush before destroying
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    this.#socket?.destroy();
    this.#registered = false;
    this.emit('unregistered');
  }

  /** True when successfully registered and heartbeating. */
  get isRegistered(): boolean {
    return this.#registered;
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  #connect(): void {
    if (this.#destroyed) return;

    const { clusterHost, clusterInternalPort } = this.#deps;

    this.#log.info(
      { host: clusterHost, port: clusterInternalPort, attempt: this.#reconnectAttempts + 1 },
      'Connecting to Cluster Server internal port...',
    );

    this.#parser = new FrameParser();
    const socket = net.createConnection({ host: clusterHost, port: clusterInternalPort });
    this.#socket = socket;

    socket.on('connect', () => {
      this.#reconnectAttempts = 0;
      this.#log.info({ host: clusterHost, port: clusterInternalPort }, 'TCP connected to Cluster Server');
      void this.#sendRegistration();
    });

    socket.on('data', (chunk: Buffer) => {
      const frames = this.#parser.feed(chunk);
      for (const frame of frames) {
        this.#handleFrame(frame.op, frame.data);
      }
    });

    socket.on('close', () => {
      const wasRegistered = this.#registered;
      this.#registered = false;
      this.#clearTimers();

      if (!this.#destroyed) {
        this.#log.warn('Connection to Cluster Server closed -- scheduling reconnect');
        if (wasRegistered) this.emit('unregistered');
        this.#scheduleReconnect();
      }
    });

    socket.on('error', (err: Error) => {
      this.#log.error({ err }, 'Cluster Server socket error');
      // 'close' event fires after 'error', so reconnect is scheduled there
    });
  }

  // ---------------------------------------------------------------------------
  // Registration handshake
  // ---------------------------------------------------------------------------

  #sendRegistration(): void {
    const { serverId, channelId, channelName, publicIp, publicPort, maxPlayers, ipcSecret } = this.#deps;

    const token = computeRegistrationToken(ipcSecret, serverId, 'world');

    const request: RegisterWorldRequest = {
      serverId,
      name: channelName,
      publicIp,
      publicPort,
      maxPlayers,
      channelId,
      registrationToken: token,
    };

    this.#log.info({ serverId, channelId }, 'Sending REGISTER_WORLD...');
    this.#send(IPC_OP.REGISTER_WORLD, request);
    // ACK is handled in #handleFrame
  }

  // ---------------------------------------------------------------------------
  // Frame dispatch
  // ---------------------------------------------------------------------------

  #handleFrame(op: number, data: unknown): void {
    switch (op) {
      case IPC_OP.REGISTER_WORLD_ACK:
        this.#onRegisterAck(data);
        break;
      case IPC_OP.WORLD_HEARTBEAT_ACK:
        this.#onHeartbeatAck(data);
        break;
      default:
        this.#log.warn({ op }, 'Received unknown IPC opcode from Cluster Server');
    }
  }

  #onRegisterAck(data: unknown): void {
    const result = RegisterWorldAckSchema.safeParse(data);
    if (!result.success) {
      this.#log.error({ errors: result.error.errors }, 'Malformed REGISTER_WORLD_ACK -- disconnecting');
      this.#socket?.destroy();
      return;
    }

    const ack: RegisterWorldAck = result.data;

    if (!ack.success) {
      this.#log.error(
        { reason: ack.reason },
        'REGISTER_WORLD rejected by Cluster Server -- will not reconnect',
      );
      // Rejected by policy (unknown ID, invalid token). Operator must fix config.
      // Destroy without scheduling reconnect.
      this.#destroyed = true;
      this.#socket?.destroy();
      return;
    }

    this.#registered = true;
    this.#log.info(
      { channelIndex: ack.channelIndex },
      'World Server registered with Cluster Server successfully',
    );
    this.emit('registered');
    this.#startHeartbeat();
  }

  #onHeartbeatAck(data: unknown): void {
    const result = WorldHeartbeatAckSchema.safeParse(data);
    if (!result.success) {
      this.#log.warn({ errors: result.error.errors }, 'Malformed WORLD_HEARTBEAT_ACK');
      return;
    }
    const rtt = Date.now() - (result.data).ts;
    this.#log.trace({ rtt }, 'Heartbeat ACK received');
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#socket || this.#socket.destroyed) return;

      const payload = {
        serverId: this.#deps.serverId,
        players: this.#deps.getPlayerCount(),
        ts: Date.now(),
      };
      this.#send(IPC_OP.WORLD_HEARTBEAT, payload);
    }, this.#deps.heartbeatIntervalMs);
  }

  // ---------------------------------------------------------------------------
  // Reconnect with exponential backoff (cap at 60 s)
  // ---------------------------------------------------------------------------

  #scheduleReconnect(): void {
    if (this.#destroyed) return;

    const base = this.#deps.reconnectIntervalMs;
    const delay = Math.min(base * 2 ** this.#reconnectAttempts, 60_000);
    this.#reconnectAttempts++;

    this.#log.info({ delay, attempt: this.#reconnectAttempts }, 'Reconnecting to Cluster Server...');
    this.emit('reconnecting');

    this.#reconnectTimer = setTimeout(() => {
      this.#connect();
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  #send(op: number, payload: unknown): void {
    if (!this.#socket || this.#socket.destroyed) return;
    try {
      this.#socket.write(encodeMessage(op, payload));
    } catch (err) {
      this.#log.error({ err }, 'Failed to write to Cluster Server socket');
    }
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  #clearTimers(): void {
    this.#clearHeartbeat();
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }
}
