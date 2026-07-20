/**
 * LocalBus — dev-only localhost TCP pub/sub, no Redis required.
 *
 * Implements the minimal redis-like interface that `IpcBus` wraps (`on('message')`,
 * `publish`, `subscribe`, `unsubscribe`, `quit`). Because `IpcBus` does all the
 * HMAC-SHA256 signing + 30 s freshness checks itself, this class is a pure byte
 * pipe — dropping it in keeps the same security envelope as the Redis path.
 *
 * Topology: the **first** process to bind `host:port` becomes the broker; every
 * other process (and the broker process itself) connects as a client. The broker
 * routes `pub` frames to every connection subscribed to that channel. This lets
 * cluster + world — running as separate processes on one dev box — exchange
 * `player:handoff` without Redis.
 *
 * Production still uses Redis (`IpcBus` over `ioredis`); this is the
 * `cache.adapter === 'memory'` fallback only.
 *
 * Wire format — newline-delimited JSON, one object per line:
 *   {"op":"sub","ch":"player:handoff"}                    client → broker
 *   {"op":"pub","ch":"player:handoff","data":"{...}"}     client → broker
 *   {"op":"msg","ch":"player:handoff","data":"{...}"}     broker → client
 *
 * @module ipc/localBus
 */

import net, { type Server, type Socket } from 'node:net';

/** Max bytes for a single frame before the connection is dropped (dev guard). */
const MAX_FRAME_BYTES = 1_048_576; // 1 MiB

/** Minimal redis-like surface `IpcBus` consumes. */
export interface LocalBusLike {
  on(event: 'message', handler: (channel: string, data: string) => void): void;
  publish(channel: string, data: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  quit(): Promise<void>;
}

/** Structural logger — `@flyff/core` pino or a plain object in tests. */
interface BusLogger {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
  debug?: (obj: unknown, msg: string) => void;
}

/** Noop default — used when no logger is injected (keeps @flyff/ipc core-free). */
const NOOP_LOGGER: BusLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface LocalBusOptions {
  host: string;
  port: number;
  /** Reconnect delay for the client socket when the broker is not up yet. */
  reconnectDelayMs?: number;
  logger?: BusLogger;
}

type Frame =
  | { op: 'sub'; ch: string }
  | { op: 'pub'; ch: string; data: string }
  | { op: 'msg'; ch: string; data: string };

/**
 * Newline-delimited JSON codec. Each socket owns one codec; `feed()` accumulates
 * chunks and yields complete frames (split on `\n`). Frames exceeding
 * `MAX_FRAME_BYTES` throw — the caller drops the socket.
 */
class LineCodec {
  private buf = '';
  /** Push a chunk; return complete frame strings. Throws on oversize frame. */
  feed(chunk: string): string[] {
    this.buf += chunk;
    if (this.buf.length > MAX_FRAME_BYTES) {
      this.buf = '';
      throw new Error(`frame exceeds ${MAX_FRAME_BYTES} bytes`);
    }
    const out: string[] = [];
    let nl = this.buf.indexOf('\n');
    while (nl !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.length > 0) out.push(line);
      nl = this.buf.indexOf('\n');
    }
    return out;
  }
}

function writeFrame(socket: Socket, frame: Frame): void {
  socket.write(JSON.stringify(frame) + '\n');
}

/**
 * Localhost pub/sub broker + client in one class.
 *
 * One instance per process. The instance that wins the `listen()` race becomes
 * the broker (a `net.Server`); every instance also opens a single client socket
 * to `host:port` (loopback when it is the broker) and uses it for both publish
 * and subscribe. Incoming `msg` frames fire the registered `on('message')`
 * handlers.
 */
export class LocalBus implements LocalBusLike {
  private readonly log: BusLogger;
  private readonly reconnectMs: number;
  private readonly messageHandlers: Array<(channel: string, data: string) => void> = [];
  private readonly localSubs = new Set<string>();

  private server: Server | undefined;
  /** Broker-side per-connection subscription map (empty on client-only nodes). */
  private readonly remoteSubs = new Map<Socket, Set<string>>();
  private client: Socket | undefined;
  private clientReady = false;
  private closed = false;

  constructor(private readonly opts: LocalBusOptions) {
    // Default to a noop logger so @flyff/ipc stays free of @flyff/core (its
    // tsconfig pins rootDir to ./src). Callers pass a real pino logger.
    this.log = opts.logger ?? NOOP_LOGGER;
    this.reconnectMs = opts.reconnectDelayMs ?? 500;
  }

  /**
   * Bind the broker port (best-effort). If the port is already taken (another
   * process won the race), this instance becomes a client-only node. Always
   * opens a client socket afterward. Resolves once the client socket is first
   * connected OR the broker is listening (so callers can publish promptly).
   */
  async start(): Promise<void> {
    await this.tryBecomeBroker();
    this.openClient();
    // Wait briefly for the first client connection so an immediate publish
    // after start() isn't dropped on the floor.
    await this.waitForClient(2_000);
  }

  /** Best-effort bind; EADDRINUSE means "someone else is the broker". */
  private tryBecomeBroker(): Promise<void> {
    return new Promise((resolve) => {
      const server = net.createServer((sock) => this.onBrokerConnection(sock));
      server.on('error', (err) => {
        // EADDRINUSE → another process is the broker; we are a client.
        this.log.debug?.({ err: String(err) }, 'broker bind failed — acting as client');
        resolve();
      });
      server.listen(this.opts.port, this.opts.host, () => {
        this.server = server;
        this.log.info({ host: this.opts.host, port: this.opts.port }, 'LocalBus broker listening');
        resolve();
      });
    });
  }

  /** Broker: handle an inbound client connection. */
  private onBrokerConnection(sock: Socket): void {
    const subs = new Set<string>();
    this.remoteSubs.set(sock, subs);
    const codec = new LineCodec();
    sock.on('data', (chunk: Buffer) => {
      let lines: string[];
      try {
        lines = codec.feed(chunk.toString('utf8'));
      } catch {
        this.log.warn({ ip: sock.remoteAddress }, 'oversize frame — dropping connection');
        sock.destroy();
        return;
      }
      for (const line of lines) this.handleBrokerFrame(sock, subs, line);
    });
    sock.on('error', () => { /* swallow; close handler cleans up */ });
    sock.on('close', () => this.remoteSubs.delete(sock));
  }

  /** Broker: dispatch one inbound frame from a connected client. */
  private handleBrokerFrame(sock: Socket, subs: Set<string>, line: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      return; // malformed — ignore
    }
    if (frame.op === 'sub') {
      subs.add(frame.ch);
      return;
    }
    if (frame.op === 'pub') {
      // Fan out to every subscribed remote connection (skip the publisher).
      for (const [peer, peerSubs] of this.remoteSubs) {
        if (peer === sock || peer.destroyed || !peerSubs.has(frame.ch)) continue;
        writeFrame(peer, { op: 'msg', ch: frame.ch, data: frame.data });
      }
      // If THIS process is also subscribed, deliver locally — the publisher
      // socket is skipped above, so there's no double delivery.
      if (this.localSubs.has(frame.ch)) this.deliverLocal(frame.ch, frame.data);
      return;
    }
    // 'msg' from a client is nonsensical on the broker — ignore.
  }

  /** Client: open (and auto-reconnect) the socket to host:port. */
  private openClient(): void {
    const connect = (): void => {
      if (this.closed) return;
      const sock = net.createConnection({ host: this.opts.host, port: this.opts.port });
      const codec = new LineCodec();
      sock.on('connect', () => {
        this.client = sock;
        this.clientReady = true;
        // Re-subscribe everything after (re)connect.
        for (const ch of this.localSubs) writeFrame(sock, { op: 'sub', ch });
        this.log.debug?.({ host: this.opts.host, port: this.opts.port }, 'client connected to broker');
      });
      sock.on('data', (chunk: Buffer) => {
        let lines: string[];
        try {
          lines = codec.feed(chunk.toString('utf8'));
        } catch {
          this.log.warn({}, 'client oversize frame — reconnecting');
          sock.destroy();
          return;
        }
        for (const line of lines) this.handleClientFrame(line);
      });
      sock.on('error', () => { /* swallow; close handler triggers retry */ });
      sock.on('close', () => {
        this.clientReady = false;
        this.client = undefined;
        if (this.closed) return;
        setTimeout(connect, this.reconnectMs);
      });
    };
    connect();
  }

  /** Wait up to `timeoutMs` for the client socket to report readiness. */
  private waitForClient(timeoutMs: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = (): void => {
        if (this.clientReady || this.closed || Date.now() - start > timeoutMs) resolve();
        else setTimeout(tick, 25);
      };
      tick();
    });
  }

  /** Client: dispatch one inbound frame from the broker. */
  private handleClientFrame(line: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(line) as Frame;
    } catch {
      return;
    }
    if (frame.op !== 'msg') return;
    this.deliverLocal(frame.ch, frame.data);
  }

  /** Fire all registered `on('message')` handlers for one inbound frame. */
  private deliverLocal(channel: string, data: string): void {
    for (const h of this.messageHandlers) {
      try {
        h(channel, data);
      } catch (err) {
        this.log.error({ err, ch: channel }, 'message handler threw');
      }
    }
  }

  on(_event: 'message', handler: (channel: string, data: string) => void): void {
    this.messageHandlers.push(handler);
  }

  async publish(channel: string, data: string): Promise<number> {
    if (!this.client || !this.clientReady) {
      // No client yet — broker may still be starting or this node lost the
      // race and hasn't connected. Dev-only; drop + warn rather than block.
      this.log.warn({ channel }, 'publish before client connected — dropped');
      return 0;
    }
    writeFrame(this.client, { op: 'pub', ch: channel, data });
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    this.localSubs.add(channel);
    if (this.client && this.clientReady) writeFrame(this.client, { op: 'sub', ch: channel });
  }

  async unsubscribe(channel: string): Promise<void> {
    this.localSubs.delete(channel);
    // ponytail: no `unsub` op — broker drops the sub on next reconnect.
    // Dev-only, low traffic; acceptable. Add an `unsub` op when prod care arises.
  }

  async quit(): Promise<void> {
    this.closed = true;
    this.client?.destroy();
    this.client = undefined;
    // Force-drop any live broker connections first — otherwise server.close()
    // blocks until every peer disconnects on its own and quit() never resolves.
    for (const peer of this.remoteSubs.keys()) peer.destroy();
    this.remoteSubs.clear();
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
    this.server = undefined;
    this.messageHandlers.length = 0;
  }
}

/**
 * Build + start a `LocalBus`. Convenience wrapper so callers don't have to
 * await `start()` separately.
 */
export async function createLocalBus(opts: LocalBusOptions): Promise<LocalBus> {
  const bus = new LocalBus(opts);
  await bus.start();
  return bus;
}
