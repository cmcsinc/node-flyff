/**
 * LoginRegistrar -- Cluster Server side of the Login registration handshake.
 *
 * Mirrors `ClusterRegistrar` (world->cluster) but in the cluster->login direction.
 * On startup this module:
 *  1. TCP-connects to the Login Server's internal IpcServer port
 *  2. Sends REGISTER_CLUSTER with a HMAC-derived registration token
 *  3. Waits for REGISTER_CLUSTER_ACK
 *  4. Drives periodic CLUSTER_HEARTBEAT carrying the live world channel list
 *     (player counts, online status) so the Login Server can show accurate info
 *  5. Auto-reconnects on disconnect
 *  6. Sends UNREGISTER_CLUSTER before intentional shutdown
 *
 * @module cluster-server/ipc/loginRegistrar
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { IPC_OP } from '@flyff/ipc';
import {
  computeRegistrationToken,
  RegisterClusterAckSchema,
  ClusterHeartbeatAckSchema,
  type RegisterClusterRequest,
  type RegisterClusterAck,
  type ClusterHeartbeat,
} from '@flyff/ipc';
import type { Logger } from 'pino';
import type { WorldRegistry } from './worldRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginRegistrarDeps {
  serverId: string;
  serverName: string;
  publicIp: string;
  publicPort: number;
  ipcSecret: string;
  loginHost: string;
  loginInternalPort: number;
  reconnectIntervalMs: number;
  heartbeatIntervalMs: number;
  /** WorldRegistry reference -- used to build the live channel list in heartbeats. */
  worldRegistry: WorldRegistry;
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
// LoginRegistrar
// ---------------------------------------------------------------------------

export class LoginRegistrar extends EventEmitter {
  readonly #deps: LoginRegistrarDeps;
  readonly #log: Logger;

  #socket: net.Socket | null = null;
  #parser: FrameParser = new FrameParser();
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #reconnectAttempts = 0;
  #registered = false;
  #destroyed = false;

  constructor(deps: LoginRegistrarDeps) {
    super();
    this.#deps = deps;
    this.#log = deps.logger.child({ component: 'LoginRegistrar' });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.#destroyed) throw new Error('LoginRegistrar has been destroyed');
    this.#connect();
  }

  async shutdown(reason = 'Server shutting down'): Promise<void> {
    this.#destroyed = true;
    this.#clearTimers();

    if (this.#socket && !this.#socket.destroyed && this.#registered) {
      this.#send(IPC_OP.UNREGISTER_CLUSTER, {
        serverId: this.#deps.serverId,
        reason,
      });
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    this.#socket?.destroy();
    this.#registered = false;
    this.emit('unregistered');
  }

  get isRegistered(): boolean {
    return this.#registered;
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  #connect(): void {
    if (this.#destroyed) return;

    const { loginHost, loginInternalPort } = this.#deps;
    this.#log.info(
      { host: loginHost, port: loginInternalPort, attempt: this.#reconnectAttempts + 1 },
      'Connecting to Login Server internal port...',
    );

    this.#parser = new FrameParser();
    const socket = net.createConnection({ host: loginHost, port: loginInternalPort });
    this.#socket = socket;

    socket.on('connect', () => {
      this.#reconnectAttempts = 0;
      this.#log.info({ host: loginHost, port: loginInternalPort }, 'TCP connected to Login Server');
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
        this.#log.warn('Connection to Login Server closed -- scheduling reconnect');
        if (wasRegistered) this.emit('unregistered');
        this.#scheduleReconnect();
      }
    });

    socket.on('error', (err: Error) => {
      this.#log.error({ err }, 'Login Server socket error');
    });
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async #sendRegistration(): Promise<void> {
    const { serverId, serverName, publicIp, publicPort, ipcSecret, worldRegistry } = this.#deps;

    const token = computeRegistrationToken(ipcSecret, serverId, 'cluster');
    const worlds = worldRegistry.getOnlineWorlds();
    const totalPlayers = worlds.reduce((sum, w) => sum + w.players, 0);
    const totalMax = worlds.reduce((sum, w) => sum + w.maxPlayers, 0);

    const request: RegisterClusterRequest = {
      serverId,
      name: serverName,
      publicIp,
      publicPort,
      channelCount: worlds.length,
      // Send the live channel list at registration so the Login Server's
      // server list has channel children immediately -- the v15 client cannot
      // proceed past server-select without a channel, and the first heartbeat
      // only fires after heartbeatIntervalMs.
      worlds: worlds.map(w => ({
        channelId: w.channelId,
        name: w.name,
        players: w.players,
        maxPlayers: w.maxPlayers,
        status: w.status,
      })),
      players: totalPlayers,
      maxPlayers: totalMax || 1, // Avoid 0 if no worlds yet
      registrationToken: token,
    };

    this.#log.info({ serverId, channelCount: worlds.length }, 'Sending REGISTER_CLUSTER...');
    this.#send(IPC_OP.REGISTER_CLUSTER, request);
  }

  // ---------------------------------------------------------------------------
  // Frame dispatch
  // ---------------------------------------------------------------------------

  #handleFrame(op: number, data: unknown): void {
    switch (op) {
      case IPC_OP.REGISTER_CLUSTER_ACK:
        this.#onRegisterAck(data);
        break;
      case IPC_OP.CLUSTER_HEARTBEAT_ACK:
        this.#onHeartbeatAck(data);
        break;
      default:
        this.#log.warn({ op }, 'Received unknown IPC opcode from Login Server');
    }
  }

  #onRegisterAck(data: unknown): void {
    const result = RegisterClusterAckSchema.safeParse(data);
    if (!result.success) {
      this.#log.error({ errors: result.error.errors }, 'Malformed REGISTER_CLUSTER_ACK');
      this.#socket?.destroy();
      return;
    }

    const ack: RegisterClusterAck = result.data;
    if (!ack.success) {
      this.#log.error({ reason: ack.reason }, 'REGISTER_CLUSTER rejected by Login Server');
      this.#destroyed = true;
      this.#socket?.destroy();
      return;
    }

    this.#registered = true;
    this.#log.info('Cluster Server registered with Login Server successfully');
    this.emit('registered');
    this.#startHeartbeat();
  }

  #onHeartbeatAck(data: unknown): void {
    const result = ClusterHeartbeatAckSchema.safeParse(data);
    if (!result.success) return;
    const rtt = Date.now() - result.data.ts;
    this.#log.trace({ rtt }, 'Cluster heartbeat ACK received');
  }

  // ---------------------------------------------------------------------------
  // Heartbeat -- carries live world channel list
  // ---------------------------------------------------------------------------

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#socket || this.#socket.destroyed) return;

      const worlds = this.#deps.worldRegistry.getOnlineWorlds();
      const payload: ClusterHeartbeat = {
        serverId: this.#deps.serverId,
        worlds: worlds.map(w => ({
          channelId: w.channelId,
          name: w.name,
          players: w.players,
          maxPlayers: w.maxPlayers,
          status: w.status,
        })),
        ts: Date.now(),
      };
      this.#send(IPC_OP.CLUSTER_HEARTBEAT, payload);
    }, this.#deps.heartbeatIntervalMs);
  }

  // ---------------------------------------------------------------------------
  // Reconnect with exponential backoff
  // ---------------------------------------------------------------------------

  #scheduleReconnect(): void {
    if (this.#destroyed) return;
    const base = this.#deps.reconnectIntervalMs;
    const delay = Math.min(base * 2 ** this.#reconnectAttempts, 60_000);
    this.#reconnectAttempts++;
    this.#log.info({ delay, attempt: this.#reconnectAttempts }, 'Reconnecting to Login Server...');
    this.emit('reconnecting');
    this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  #send(op: number, payload: unknown): void {
    if (!this.#socket || this.#socket.destroyed) return;
    try {
      this.#socket.write(encodeMessage(op, payload));
    } catch (err) {
      this.#log.error({ err }, 'Failed to write to Login Server socket');
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
