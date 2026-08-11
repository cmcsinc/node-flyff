import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  PacketBuffer,
  PacketReader,
  framePacket,
  PACKETTYPE,
  lookupPacketType,
  createLogger,
  type PacketWriter,
} from '@flyff/core';
import type { ClientSession } from './ClientSession';
import type { PacketHandlerMap } from './types';

const logger = createLogger({ module: 'gateway' });

export interface GatewayOptions {
  port: number;
  host?: string;
  handlers: PacketHandlerMap;
}

export class Gateway {
  private wss: WebSocketServer | null = null;
  private sessions = new Map<WebSocket, ClientSession>();

  constructor(private opts: GatewayOptions) {}

  async start(): Promise<void> {
    const { port, host } = this.opts;

    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port, host });

      this.wss.on('connection', (ws, req) => {
        this.onConnection(ws, req);
      });

      this.wss.on('listening', () => {
        logger.info({ port, host: host ?? '0.0.0.0' }, 'Gateway WebSocket server listening');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const [ws] of this.sessions) {
      ws.close(1001, 'Server shutting down');
    }
    this.sessions.clear();

    const { wss } = this;
    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
    }
    logger.info('Gateway stopped');
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const session: ClientSession = {
      ws,
      ip,
      state: 'connected',
      buffer: new PacketBuffer(),
      accountId: null,
      characterId: null,
      moverId: null,
      data: {},
    };

    this.sessions.set(ws, session);
    logger.info({ ip }, 'Client connected');

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        logger.warn({ ip }, 'Received non-binary message, ignoring');
        return;
      }
      this.onMessage(session, data);
    });

    ws.on('close', (code, reason) => {
      this.onDisconnect(session, code, reason.toString());
    });

    ws.on('error', (err) => {
      logger.error({ ip, err: err.message }, 'WebSocket error');
    });
  }

  private onMessage(session: ClientSession, data: Buffer): void {
    session.buffer.push(data);
    const packets = session.buffer.drain();

    for (const payload of packets) {
      this.dispatchPacket(session, payload);
    }
  }

  private dispatchPacket(session: ClientSession, payload: Buffer): void {
    if (payload.length < 4) {
      logger.warn({ ip: session.ip }, 'Packet too short for opcode');
      return;
    }

    const reader = new PacketReader(payload);
    const opcode = reader.readDword();
    const name = lookupPacketType(opcode) ?? `0x${opcode.toString(16)}`;

    const handler = this.opts.handlers[opcode];
    if (!handler) {
      logger.debug({ opcode: name, ip: session.ip }, 'No handler for opcode');
      return;
    }

    logger.debug({ opcode: name, ip: session.ip }, 'Dispatching packet');

    Promise.resolve(handler(session, reader)).catch((err: unknown) => {
      logger.error({ opcode: name, err }, 'Handler error');
    });
  }

  private onDisconnect(session: ClientSession, code: number, reason: string): void {
    logger.info({ ip: session.ip, code, reason }, 'Client disconnected');

    const handler = this.opts.handlers[PACKETTYPE.LEAVE];
    if (handler && session.state === 'in_world') {
      Promise.resolve(handler(session, new PacketReader(Buffer.alloc(0)))).catch((err: unknown) => {
        logger.error({ ip: session.ip, err }, 'LEAVE handler error');
      });
    }

    this.sessions.delete(session.ws);
  }

  broadcast(payload: Buffer): void {
    const framed = framePacket(payload);
    for (const [ws] of this.sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(framed);
      }
    }
  }

  sendToSession(session: ClientSession, writer: PacketWriter): void {
    const payload = writer.build();
    const framed = framePacket(payload);
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(framed);
    }
  }

  getSessions(): IterableIterator<ClientSession> {
    return this.sessions.values();
  }

  getOnlineCount(): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.state === 'in_world') count++;
    }
    return count;
  }
}
