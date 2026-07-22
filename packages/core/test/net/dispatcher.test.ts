import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import net, { type Socket, type Server } from 'node:net';
import { PacketDispatcher, sendPacket, type DispatcherLogger, type ClientSocket } from '../../src/net/dispatcher.js';
import { PacketWriter } from '../../src/net/PacketWriter.js';
import { PacketBuffer, framePacket } from '../../src/net/PacketBuffer.js';
import { PACKETTYPE } from '../../src/constants/opcodes.js';
import { SessionState } from '../../src/constants/sessionState.js';

/**
 * Real loopback TCP exercise of the dispatcher: frame reassembly across split
 * chunks, multi-frame batches, unknown-opcode drop, handler-throw containment,
 * session attach, and framed replies. No mocks -- actual net.Server + sockets.
 */

const TEST_TIMEOUT = 8000;

function silentLogger(): DispatcherLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function captureLogger() {
  const calls: Array<[string, string]> = [];
  const log: DispatcherLogger = {
    info: (_o, m) => calls.push(['info', m]),
    warn: (_o, m) => calls.push(['warn', m]),
    error: (_o, m) => calls.push(['error', m]),
  };
  return { log, calls };
}

/** Framed payload: leading opcode DWORD + body, wrapped in the 0x5E frame. */
function framed(opcode: number, body: Buffer = Buffer.alloc(0)): Buffer {
  const op = Buffer.allocUnsafe(4);
  op.writeUInt32LE(opcode >>> 0, 0);
  return framePacket(Buffer.concat([op, body]));
}

interface Harness {
  dispatcher: PacketDispatcher;
  port: number;
  close: () => Promise<void>;
}

async function withHarness(logger: DispatcherLogger = silentLogger(), opts: { leadsWithDpid?: boolean; crc?: boolean; onDisconnect?: (socket: ClientSocket) => void } = {}): Promise<Harness> {
  const dispatcher = new PacketDispatcher({ logger, leadsWithDpid: opts.leadsWithDpid, crc: opts.crc, onDisconnect: opts.onDisconnect });
  const server: Server = net.createServer();
  dispatcher.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  server.unref();
  const port = (server.address() as net.AddressInfo).port;
  return { dispatcher, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s));
    s.unref();
  });
}

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('PacketDispatcher', () => {
  it('reassembles a frame split across two chunks and dispatches once', { timeout: TEST_TIMEOUT }, async () => {
    const h = await withHarness();
    let calls = 0;
    let seen = 0;
    h.dispatcher.register(PACKETTYPE.CERTIFY, (_s, reader) => {
      calls++;
      seen = reader.readDword();
    });
    const body = new PacketWriter().writeDword(0xabcdef12).build();
    const frame = framed(PACKETTYPE.CERTIFY, body);
    const sock = await connect(h.port);
    sock.write(frame.subarray(0, 3));
    sock.write(frame.subarray(3));
    await tick(30);
    assert.equal(calls, 1);
    assert.equal(seen, 0xabcdef12);
    sock.destroy();
    await h.close();
  });

  it('dispatches multiple frames delivered in one chunk', { timeout: TEST_TIMEOUT }, async () => {
    const h = await withHarness();
    let calls = 0;
    h.dispatcher.register(PACKETTYPE.JOIN, () => { calls++; });
    const sock = await connect(h.port);
    sock.write(Buffer.concat([framed(PACKETTYPE.JOIN), framed(PACKETTYPE.JOIN), framed(PACKETTYPE.JOIN)]));
    await tick(30);
    assert.equal(calls, 3);
    sock.destroy();
    await h.close();
  });

  it('attaches a CONNECTED session to each client socket', { timeout: TEST_TIMEOUT }, async () => {
    const h = await withHarness();
    let state = -1;
    h.dispatcher.register(PACKETTYPE.PRE_JOIN, (socket) => { state = socket.session.state; });
    const sock = await connect(h.port);
    sock.write(framed(PACKETTYPE.PRE_JOIN));
    await tick(30);
    assert.equal(state, SessionState.CONNECTED);
    sock.destroy();
    await h.close();
  });

  it('drops an unknown opcode without invoking a handler (warned)', { timeout: TEST_TIMEOUT }, async () => {
    const { log, calls } = captureLogger();
    const h = await withHarness(log);
    let invoked = false;
    h.dispatcher.register(PACKETTYPE.JOIN, () => { invoked = true; });
    const sock = await connect(h.port);
    sock.write(framed(0xdeadbeef));
    await tick(30);
    assert.equal(invoked, false);
    assert.ok(calls.some((c) => c[0] === 'warn' && /Unknown opcode/.test(c[1])));
    sock.destroy();
    await h.close();
  });

  it('contains a handler throw -- subsequent frames still dispatch, error logged', { timeout: TEST_TIMEOUT }, async () => {
    const { log, calls } = captureLogger();
    const h = await withHarness(log);
    h.dispatcher.register(PACKETTYPE.GETPLAYERLIST, () => { throw new Error('boom'); });
    let survivor = 0;
    h.dispatcher.register(PACKETTYPE.JOIN, () => { survivor++; });
    const sock = await connect(h.port);
    sock.write(framed(PACKETTYPE.GETPLAYERLIST));
    sock.write(framed(PACKETTYPE.JOIN));
    await tick(30);
    assert.ok(calls.some((c) => c[0] === 'error' && /handler threw/.test(c[1])));
    assert.equal(survivor, 1);
    sock.destroy();
    await h.close();
  });

  it('sendPacket frames a reply the client can drain', { timeout: TEST_TIMEOUT }, async () => {
    const h = await withHarness();
    const reply = new PacketWriter().writeDword(PACKETTYPE.SRVR_LIST).writeDword(7).build();
    h.dispatcher.register(PACKETTYPE.SRVR_LIST, (socket) => { sendPacket(socket, reply); });
    const sock = await connect(h.port);
    const sink = new PacketBuffer();
    sock.on('data', (c) => sink.push(c));
    sock.write(framed(PACKETTYPE.SRVR_LIST));
    let frames: Buffer[] = [];
    for (let i = 0; i < 50 && frames.length === 0; i++) {
      await tick(10);
      frames = sink.drain();
    }
    assert.equal(frames.length, 1);
    assert.equal(frames[0]!.readUInt32LE(0), PACKETTYPE.SRVR_LIST);
    assert.equal(frames[0]!.readUInt32LE(4), 7);
    sock.destroy();
    await h.close();
  });

  it('crc mode: sends a plain-framed protocolId hello on connect (server-first)', { timeout: TEST_TIMEOUT }, async () => {
    // v15 crcRead server: on accept it must SEND [DWORD 0][DWORD protocolId]
    // plain-framed. The real client blocks 10s waiting for this, else drops.
    const h = await withHarness(silentLogger(), { crc: true });
    const sock = await connect(h.port);
    const sink = new PacketBuffer();
    sock.on('data', (c) => sink.push(c));
    let frames: Buffer[] = [];
    for (let i = 0; i < 50 && frames.length === 0; i++) {
      await tick(10);
      frames = sink.drain();
    }
    assert.equal(frames.length, 1, 'exactly one hello frame on connect');
    assert.equal(frames[0]!.length, 8, 'hello payload is 8 bytes');
    assert.equal(frames[0]!.readUInt32LE(0), 0, 'hello leads with DWORD 0');
    assert.notEqual(frames[0]!.readUInt32LE(4), 0, 'protocolId is non-zero');
    sock.destroy();
    await h.close();
  });

  it('leadsWithDpid: skips the leading DPID DWORD, reads opcode at offset 4', async () => {
    const h = await withHarness(silentLogger(), { leadsWithDpid: true });
    let seen = 0;
    h.dispatcher.register(PACKETTYPE.GETPLAYERLIST, (_s, reader) => { seen = reader.readDword(); });
    // Wire payload: [DPID 0xFFFFFFFF][opcode][field 0xabcdef].
    const op = Buffer.allocUnsafe(4);
    op.writeUInt32LE(PACKETTYPE.GETPLAYERLIST, 0);
    const dpid = Buffer.allocUnsafe(4);
    dpid.writeUInt32LE(0xffffffff, 0);
    const field = new PacketWriter().writeDword(0xabcdef).build();
    const sock = await connect(h.port);
    sock.write(framePacket(Buffer.concat([dpid, op, field])));
    await tick(30);
    // Handler registered under the real opcode (not 0), proving the DPID was skipped.
    assert.equal(seen, 0xabcdef);
    sock.destroy();
    await h.close();
  });

  it('fires onDisconnect with the session attached when a client closes', { timeout: TEST_TIMEOUT }, async () => {
    let fired = false;
    let sessionState = -1;
    let charId: number | undefined = 999;
    const h = await withHarness(silentLogger(), {
      onDisconnect: (socket) => {
        fired = true;
        sessionState = socket.session.state;
        charId = socket.session.charId;
      },
    });
    const sock = await connect(h.port);
    sock.destroy();
    for (let i = 0; i < 50 && !fired; i++) await tick(10);
    assert.equal(fired, true, 'onDisconnect fired after close');
    assert.equal(sessionState, SessionState.CONNECTED, 'session still readable in the hook');
    assert.equal(charId, undefined, 'no JOIN ran, so charId is unset');
    await h.close();
  });

  it('contains an onDisconnect throw -- cleanup proceeds, error logged', { timeout: TEST_TIMEOUT }, async () => {
    const { log, calls } = captureLogger();
    const h = await withHarness(log, {
      onDisconnect: () => { throw new Error('hook boom'); },
    });
    const sock = await connect(h.port);
    sock.destroy();
    let saw = false;
    for (let i = 0; i < 50 && !saw; i++) {
      await tick(10);
      saw = calls.some((c) => c[0] === 'error' && /onDisconnect hook threw/.test(c[1]));
    }
    assert.equal(saw, true, 'hook throw was logged as an error');
    await h.close();
  });
});
