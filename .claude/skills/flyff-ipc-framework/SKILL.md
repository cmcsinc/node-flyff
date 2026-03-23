---
name: flyff-ipc-framework
description: >
  The @flyff/ipc secure inter-server communication framework: IpcBus (HMAC-signed Redis pub/sub),
  IpcServer and IpcClient (internal TLS TCP for request/response), HMAC-SHA256 message signing,
  CircuitBreaker for resilience, and Zod schemas for all IPC message types. Use this skill when
  building the IPC package, implementing signing/verification, adding new IPC message types,
  setting up TLS TCP connections between servers, or implementing circuit breaking for IPC calls.
  Trigger on: "IpcBus", "IpcServer", "IpcClient", "signing", "verifyIpcMessage", "signIpcMessage",
  "circuit breaker", "IPC framework", "@flyff/ipc", "HMAC", "TLS", "internal TCP", "mutual TLS",
  "mTLS", "IPC schema", "message envelope", "replay attack", "IPC secret".
---

# Flyff Emulator — @flyff/ipc Framework

## Package Structure

```
packages/ipc/
  src/
    IpcBus.ts       ← HMAC-signed Redis pub/sub (async events)
    IpcServer.ts    ← Internal TLS TCP server (sync req/res)
    IpcClient.ts    ← Internal TLS TCP client (sync req/res)
    signing.ts      ← signIpcMessage / verifyIpcMessage
    circuit.ts      ← CircuitBreaker
    schemas/
      playerEnter.schema.ts
      playerLeft.schema.ts
      gmAnnounce.schema.ts
      serverStatus.schema.ts
      shutdown.schema.ts
  index.ts
```

---

## Message Signing (`signing.ts`)

```ts
// packages/ipc/src/signing.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IpcEnvelope } from './types.js';

/**
 * Signs an IPC message envelope using HMAC-SHA256.
 * The signature covers: ts + from + JSON(payload)
 */
export function signIpcMessage<T>(
  payload: T,
  from: string,
  secret: string,
): IpcEnvelope<T> {
  const ts = Date.now();
  const body = `${ts}:${from}:${JSON.stringify(payload)}`;
  const sig  = createHmac('sha256', secret).update(body).digest('hex');
  return { ts, from, sig, payload };
}

/**
 * Verifies an IPC message envelope. Throws if invalid.
 *
 * @throws {Error} on invalid signature, expired message, or missing fields
 */
export function verifyIpcMessage<T>(
  envelope: IpcEnvelope<T>,
  secret: string,
  maxAgeMs = 30_000,
): T {
  const { ts, from, sig, payload } = envelope;

  if (!ts || !from || !sig || payload === undefined) {
    throw new Error('IPC: malformed envelope');
  }

  // Replay protection — reject stale messages
  if (Date.now() - ts > maxAgeMs) {
    throw new Error(`IPC: message too old (${Date.now() - ts}ms)`);
  }

  // Constant-time HMAC comparison
  const body     = `${ts}:${from}:${JSON.stringify(payload)}`;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual   = Buffer.from(sig, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('IPC: invalid signature');
  }

  return payload;
}
```

---

## IpcBus (Redis pub/sub)

```ts
// packages/ipc/src/IpcBus.ts
import type { ICacheAdapter } from '@flyff/core/cache/ICacheAdapter.js';
import { signIpcMessage, verifyIpcMessage } from './signing.js';
import { logger } from '@flyff/core/logger.js';
import type { IpcEnvelope } from './types.js';

type Handler<T> = (payload: T) => void | Promise<void>;

export class IpcBus {
  readonly #cache: ICacheAdapter;
  readonly #secret: string;
  readonly #serverId: string;
  readonly #handlers = new Map<string, Handler<unknown>>();

  constructor(cache: ICacheAdapter, secret: string, serverId: string) {
    if (!cache.subscribe || !cache.publish) {
      throw new Error('IpcBus requires a pub/sub-capable ICacheAdapter');
    }
    this.#cache    = cache;
    this.#secret   = secret;
    this.#serverId = serverId;
  }

  /**
   * Publish a signed message to a channel.
   */
  async publish<T>(channel: string, payload: T): Promise<void> {
    const envelope = signIpcMessage(payload, this.#serverId, this.#secret);
    await this.#cache.publish!(channel, JSON.stringify(envelope));
  }

  /**
   * Subscribe to a channel. Messages are auto-verified before the handler is called.
   */
  async subscribe<T>(channel: string, handler: Handler<T>): Promise<void> {
    this.#handlers.set(channel, handler as Handler<unknown>);
    await this.#cache.subscribe!(channel, (raw: string) => {
      void this.#dispatch(channel, raw);
    });
  }

  async #dispatch(channel: string, raw: string): Promise<void> {
    try {
      const envelope = JSON.parse(raw) as IpcEnvelope<unknown>;
      const payload  = verifyIpcMessage(envelope, this.#secret);
      const handler  = this.#handlers.get(channel);
      if (handler) await handler(payload);
    } catch (err) {
      logger.warn({ err, channel }, 'IPC: rejected message');
    }
  }
}
```

---

## IpcServer (Internal TLS TCP)

For synchronous request/response patterns. Uses mutual TLS (mTLS) between servers.

```ts
// packages/ipc/src/IpcServer.ts
import tls from 'node:tls';
import fs from 'node:fs';
import { PacketBuffer, PacketReader, PacketWriter } from '@flyff/core/net/index.js';
import { verifyIpcMessage } from './signing.js';
import { logger } from '@flyff/core/logger.js';

type RequestHandler = (reader: PacketReader, writer: PacketWriter, reqId: number) => Promise<void>;

export class IpcServer {
  readonly #handlers = new Map<number, RequestHandler>();  // opcode → handler
  #server: tls.Server | null = null;

  constructor(
    private readonly secret: string,
    private readonly certPath: string,
    private readonly keyPath: string,
    private readonly caPath: string,
  ) {}

  /** Register a handler for a given internal opcode. */
  handle(opcode: number, handler: RequestHandler): void {
    this.#handlers.set(opcode, handler);
  }

  listen(port: number, host = '127.0.0.1'): void {
    this.#server = tls.createServer({
      cert:               fs.readFileSync(this.certPath),
      key:                fs.readFileSync(this.keyPath),
      ca:                 fs.readFileSync(this.caPath),
      requestCert:        true,   // require client cert (mTLS)
      rejectUnauthorized: true,
    }, socket => {
      const buf = new PacketBuffer();
      socket.on('data', (chunk: Buffer) => {
        buf.push(chunk);
        for (const pkt of buf.drain()) {
          void this.#handlePacket(socket, pkt);
        }
      });
      socket.on('error', err => logger.warn({ err }, 'IpcServer socket error'));
    });

    this.#server.listen(port, host, () => {
      logger.info({ port, host }, 'IpcServer listening');
    });
  }

  async #handlePacket(socket: tls.TLSSocket, pkt: Buffer): Promise<void> {
    try {
      const reader = new PacketReader(pkt);
      reader.readWord(); // header
      const opcode = reader.readWord();
      const reqId  = reader.readDword();
      // Read and verify signed envelope
      const envelopeJson = reader.readString();
      const envelope = JSON.parse(envelopeJson);
      verifyIpcMessage(envelope, this.secret);

      const handler = this.#handlers.get(opcode);
      if (!handler) {
        logger.warn({ opcode }, 'IpcServer: unknown opcode');
        return;
      }

      const writer = new PacketWriter(opcode);
      writer.writeDword(reqId);
      await handler(reader, writer, reqId);
      socket.write(writer.build());
    } catch (err) {
      logger.warn({ err }, 'IpcServer: request failed');
    }
  }

  close(): void { this.#server?.close(); }
}
```

---

## IpcClient (Internal TLS TCP)

```ts
// packages/ipc/src/IpcClient.ts
import tls from 'node:tls';
import fs from 'node:fs';
import { PacketBuffer, PacketReader, PacketWriter } from '@flyff/core/net/index.js';
import { signIpcMessage } from './signing.js';

type Pending = { resolve: (r: PacketReader) => void; reject: (e: Error) => void };

export class IpcClient {
  #socket: tls.TLSSocket | null = null;
  #buf    = new PacketBuffer();
  #pending = new Map<number, Pending>();
  #reqId  = 0;
  #secret: string;

  constructor(
    secret: string,
    private readonly certPath: string,
    private readonly keyPath: string,
    private readonly caPath: string,
  ) {
    this.#secret = secret;
  }

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#socket = tls.connect({
        host, port,
        cert:               fs.readFileSync(this.certPath),
        key:                fs.readFileSync(this.keyPath),
        ca:                 fs.readFileSync(this.caPath),
        checkServerIdentity: () => undefined, // trusted by CA
      }, () => resolve());

      this.#socket.on('data', (chunk: Buffer) => {
        this.#buf.push(chunk);
        for (const pkt of this.#buf.drain()) this.#handleResponse(pkt);
      });

      this.#socket.on('error', reject);
    });
  }

  /**
   * Send a request and await the response.
   * @param opcode Internal opcode
   * @param buildFn Callback to write request payload
   * @param timeoutMs Response timeout
   */
  request(opcode: number, buildFn: (w: PacketWriter) => void, timeoutMs = 5_000): Promise<PacketReader> {
    return new Promise((resolve, reject) => {
      const id = this.#reqId++;
      const w  = new PacketWriter(opcode);
      w.writeDword(id);

      // Sign the request
      const envelope = signIpcMessage({ opcode, reqId: id }, 'client', this.#secret);
      w.writeString(JSON.stringify(envelope));

      buildFn(w);
      this.#socket!.write(w.build());

      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`IPC timeout for opcode 0x${opcode.toString(16)}`));
        }
      }, timeoutMs);
    });
  }

  #handleResponse(pkt: Buffer): void {
    const r     = new PacketReader(pkt);
    r.readWord(); r.readWord(); // header + opcode
    const reqId = r.readDword();
    const entry = this.#pending.get(reqId);
    if (entry) {
      this.#pending.delete(reqId);
      entry.resolve(r);
    }
  }

  disconnect(): void { this.#socket?.destroy(); }
}
```

---

## CircuitBreaker

```ts
// packages/ipc/src/circuit.ts

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  #state: CircuitState = 'CLOSED';
  #failures = 0;
  #lastFailure = 0;

  constructor(
    private readonly threshold = 5,
    private readonly resetMs   = 30_000,
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#state === 'OPEN') {
      if (Date.now() - this.#lastFailure > this.resetMs) {
        this.#state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker OPEN');
      }
    }

    try {
      const result = await fn();
      if (this.#state === 'HALF_OPEN') this.#reset();
      return result;
    } catch (err) {
      this.#recordFailure();
      throw err;
    }
  }

  #recordFailure(): void {
    this.#failures++;
    this.#lastFailure = Date.now();
    if (this.#failures >= this.threshold) this.#state = 'OPEN';
  }

  #reset(): void {
    this.#failures = 0;
    this.#state    = 'CLOSED';
  }

  get state(): CircuitState { return this.#state; }
}
```

---

## IPC Schemas

```ts
// packages/ipc/src/schemas/playerEnter.schema.ts
import { z } from 'zod';

export const PlayerEnterSchema = z.object({
  token:     z.string().uuid(),
  accountId: z.number().int().positive(),
  charId:    z.number().int().positive(),
  zoneId:    z.number().int().positive(),
});
export type PlayerEnterPayload = z.infer<typeof PlayerEnterSchema>;

// packages/ipc/src/schemas/gmAnnounce.schema.ts
export const GmAnnounceSchema = z.object({
  message:  z.string().max(256),
  senderId: z.number().int().positive(),
});
export type GmAnnouncePayload = z.infer<typeof GmAnnounceSchema>;

// packages/ipc/src/schemas/serverStatus.schema.ts
export const ServerStatusSchema = z.object({
  id:         z.string(),
  name:       z.string(),
  ip:         z.string(),
  port:       z.number().int(),
  players:    z.number().int().min(0),
  maxPlayers: z.number().int().positive(),
  status:     z.enum(['online', 'offline', 'maintenance']),
});
export type ServerStatusPayload = z.infer<typeof ServerStatusSchema>;
```

---

## Package `index.ts`

```ts
// packages/ipc/index.ts
export { IpcBus }          from './src/IpcBus.js';
export { IpcServer }       from './src/IpcServer.js';
export { IpcClient }       from './src/IpcClient.js';
export { CircuitBreaker }  from './src/circuit.js';
export { signIpcMessage, verifyIpcMessage } from './src/signing.js';
export type { IpcEnvelope } from './src/types.js';
```