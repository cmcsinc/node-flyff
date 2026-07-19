/**
 * Client-facing packet dispatcher.
 *
 * Reassembles the v19 wire frame (`[0x5E marker][DWORD size LE][payload]` via
 * `PacketBuffer.drain()`), reads the leading DWORD opcode, and routes the
 * remaining fields to the registered handler. Every socket error is caught at
 * the socket level so one bad client can never crash the server (rule 03).
 *
 * Handlers receive a `ClientSocket` (raw `net.Socket` with a `session` attached)
 * and a `PacketReader` positioned AFTER the opcode DWORD — matching the
 * `Handler` layer contract (dispatcher strips frame + opcode; handler reads
 * fields, replies via `sendPacket()`).
 *
 * @module net/dispatcher
 */

import net, { type Server, type Socket } from 'node:net';
import { PacketBuffer, framePacket } from './PacketBuffer.js';
import { PacketReader } from './PacketReader.js';
import { SessionState, type SessionStateValue } from '../constants/sessionState.js';
import { tryDecodeCrcFrame, CRC_HEADER_SIZE, CRC_HEADERMARK, CRC_MAX_BUFFER } from './crcFrame.js';

/** Per-connection session state. Handlers gate access by `session.state`. */
export interface ClientSession {
  state: SessionStateValue;
  accountId?: number;
  charId?: number;
  /** v15 `__CRC` frame mode (certifier/login path). False ⇒ 5-byte plain frame. */
  crc?: boolean;
  /** Per-connection protocolId negotiated via the 8-byte hello (CRC mode). */
  protocolId?: number;
}

/** A client TCP socket with its session attached by the dispatcher. */
export type ClientSocket = Socket & { session: ClientSession };

/** Handler signature: receives the socket + a reader over the post-opcode fields. */
export type PacketHandler = (
  socket: ClientSocket,
  reader: PacketReader,
) => void | Promise<void>;

/** Structural logger the dispatcher needs (pino or a plain object in tests). */
export interface DispatcherLogger {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
  debug?: (obj: unknown, msg: string) => void;
}

/**
 * Frame a payload (opcode + fields) and write it to the client.
 *
 * ALWAYS the plain 5-byte frame. The v15 certifier/login path is a `crcRead`
 * server: it READS 13-byte `__CRC` frames from the client but WRITES plain
 * 5-byte frames back (its send buffer has no crc, `serversock.cpp`). The frame
 * direction is asymmetric — do not CRC outbound.
 */
export function sendPacket(socket: Socket, payload: Buffer): boolean {
  return socket.write(framePacket(payload));
}

/**
 * Sentinel for opcode-only frames (no body). `PacketReader` rejects a truly
 * empty buffer, so a 1-byte placeholder lets body-less packets dispatch;
 * handlers that try to read a field that isn't there still throw PacketError
 * (caught + logged by `dispatch`).
 */
const EMPTY_BODY = Buffer.from([0]);

export interface PacketDispatcherDeps {
  logger?: DispatcherLogger;
  /** Use the 13-byte v15 `__CRC` frame (certifier/login path). Default plain. */
  crc?: boolean;
  /**
   * Client packets lead with a `DPID_UNKNOWN` DWORD before the opcode
   * (`BEFORESENDSOLE`, all LoginServer + WorldServer paths). The certifier
   * (`BEFORESEND`) does not. Default false.
   */
  leadsWithDpid?: boolean;
}

export class PacketDispatcher {
  private readonly handlers = new Map<number, PacketHandler>();
  private readonly buffers = new WeakMap<Socket, PacketBuffer>();
  private readonly crcBuf = new WeakMap<Socket, Buffer>();
  private readonly log: DispatcherLogger | undefined;
  private readonly crc: boolean;
  private readonly leadsWithDpid: boolean;

  constructor(deps: PacketDispatcherDeps = {}) {
    this.log = deps.logger;
    this.crc = deps.crc ?? false;
    this.leadsWithDpid = deps.leadsWithDpid ?? false;
  }

  /** Monotonic source for per-connection protocolId (C++ uses GetTickCount). */
  private pidSeq = (Date.now() & 0x7fffffff) >>> 0;

  /** Generate a non-zero DWORD protocolId for a new CRC connection. */
  private newProtocolId(): number {
    this.pidSeq = (this.pidSeq + 0x9e3779b1) >>> 0; // golden-ratio step, stays spread out
    return this.pidSeq === 0 ? 1 : this.pidSeq;
  }

  /** Register a handler for a `PACKETTYPE_*` opcode. */
  register(opcode: number, handler: PacketHandler): void {
    this.handlers.set(opcode >>> 0, handler);
  }

  /** Whether a handler is registered for `opcode` (introspection / tests). */
  hasHandler(opcode: number): boolean {
    return this.handlers.has(opcode >>> 0);
  }

  /** Wire connection handling onto a `net.Server` (call before `listen`). */
  attach(server: Server): void {
    server.on('connection', (raw: Socket) => this.onConnection(raw));
  }

  private onConnection(raw: Socket): void {
    const socket = raw as ClientSocket;
    socket.session = { state: SessionState.CONNECTED, crc: this.crc, protocolId: 0 };
    if (!this.crc) this.buffers.set(raw, new PacketBuffer());
    this.log?.info({ ip: socket.remoteAddress, crc: this.crc }, 'Client connected');
    // v15 CRC path: the server is `crcRead` — it must SEND the protocolId hello
    // FIRST (plain-framed, server→client). The client blocks in
    // WaitForSingleObject(10s) waiting for it, then disconnects on timeout.
    // Hello payload = [DWORD 0][DWORD protocolId]; protocolId must be non-zero.
    if (this.crc) {
      const pid = this.newProtocolId();
      socket.session.protocolId = pid;
      const hello = Buffer.alloc(8);
      hello.writeUInt32LE(pid, 4);
      socket.write(framePacket(hello));
      this.log?.debug?.({ protocolId: pid, ip: socket.remoteAddress }, 'protocolId hello sent');
    }
    socket.on('data', (chunk: Buffer) => this.onData(socket, chunk));
    socket.on('error', (err: Error) => {
      this.log?.warn({ err, ip: socket.remoteAddress }, 'Client socket error');
    });
    socket.on('close', () => {
      this.buffers.delete(raw);
      this.crcBuf.delete(raw);
      this.log?.info({ ip: socket.remoteAddress }, 'Client disconnected');
    });
  }

  private onData(socket: ClientSocket, chunk: Buffer): void {
    this.log?.debug?.(
      { bytes: chunk.length, first: chunk[0], hex: chunk.subarray(0, Math.min(32, chunk.length)).toString('hex') },
      'raw client data',
    );
    if (socket.session.crc) {
      this.onCrcData(socket, chunk);
      return;
    }
    const buf = this.buffers.get(socket);
    if (!buf) return;
    buf.push(chunk);
    for (const payload of buf.drain()) void this.dispatch(socket, payload);
  }

  /**
   * v15 `__CRC` reassembly: verify each inbound frame against the
   * server-generated `session.protocolId` (sent in the hello on accept) and
   * dispatch. The client never sends a hello — it adopts ours.
   */
  private onCrcData(socket: ClientSocket, chunk: Buffer): void {
    const prev = this.crcBuf.get(socket) ?? Buffer.alloc(0);
    let buf = Buffer.concat([prev, chunk]);
    for (;;) {
      const pid = socket.session.protocolId ?? 0;
      const dec = tryDecodeCrcFrame(buf, pid);
      if (dec) {
        void this.dispatch(socket, dec.payload);
        buf = buf.subarray(dec.bytesConsumed);
        continue;
      }
      // No decode. If a full frame is buffered but failed verification ⇒ CRC
      // failure (C++ drops the socket, `clientsock.cpp:388-392`). Otherwise
      // it's just an incomplete frame — keep buffering.
      if (buf.length >= CRC_HEADER_SIZE && buf[0] === CRC_HEADERMARK) {
        const sizeDword = buf.readUInt32LE(5);
        if (sizeDword <= CRC_MAX_BUFFER && buf.length >= CRC_HEADER_SIZE + sizeDword) {
          this.log?.warn({ pid }, 'CRC frame verification failed — dropping socket');
          socket.destroy();
          this.crcBuf.set(socket, Buffer.alloc(0));
          return;
        }
      }
      break;
    }
    this.crcBuf.set(socket, buf);
  }

  private async dispatch(socket: ClientSocket, payload: Buffer): Promise<void> {
    const off = this.leadsWithDpid ? 4 : 0; // skip the leading DPID DWORD (BEFORESENDSOLE)
    if (payload.length < off + 4) {
      this.log?.warn({ len: payload.length }, 'Undersized payload — dropping');
      return;
    }
    const opcode = payload.readUInt32LE(off);
    this.log?.debug?.(
      { dir: 'in', opcode: `0x${opcode.toString(16)}`, len: payload.length, hex: payload.subarray(0, Math.min(48, payload.length)).toString('hex') },
      'frame',
    );
    const handler = this.handlers.get(opcode);
    if (!handler) {
      this.log?.warn({ opcode: `0x${opcode.toString(16)}` }, 'Unknown opcode — dropping');
      return;
    }
    try {
      const body = payload.subarray(off + 4);
      await handler(socket, new PacketReader(body.length > 0 ? body : EMPTY_BODY));
    } catch (err) {
      this.log?.error({ err, opcode: `0x${opcode.toString(16)}` }, 'Packet handler threw');
    }
  }
}

/**
 * Create a client-facing TCP server with a dispatcher attached. Register opcode
 * handlers on the returned `dispatcher`, then `server.listen(port)`.
 */
export function createClientServer(deps: { logger?: DispatcherLogger; crc?: boolean; leadsWithDpid?: boolean } = {}): {
  server: Server;
  dispatcher: PacketDispatcher;
} {
  const dd: PacketDispatcherDeps = {};
  if (deps.logger !== undefined) dd.logger = deps.logger;
  if (deps.crc) dd.crc = true;
  if (deps.leadsWithDpid) dd.leadsWithDpid = true;
  const dispatcher = new PacketDispatcher(dd);
  const server = net.createServer();
  dispatcher.attach(server);
  return { server, dispatcher };
}
