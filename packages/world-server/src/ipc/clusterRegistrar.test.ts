import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import net from 'node:net';
import type { Logger } from 'pino';
import { ClusterRegistrar } from './clusterRegistrar.js';
import { IPC_OP, computeRegistrationToken, type RegisterWorldRequest, type RegisterWorldAck, type WorldHeartbeatAck } from '@flyff/ipc';

const DUMMY_LOGGER = {
  child: () => DUMMY_LOGGER,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
} as unknown as Logger;

function encodeMessage(opcode: number, payload: unknown): Buffer {
  const body = JSON.stringify({ op: opcode, data: payload });
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(Buffer.byteLength(body, 'utf8'), 0);
  return Buffer.concat([len, Buffer.from(body, 'utf8')]);
}

describe('ClusterRegistrar (World Server)', () => {
  let registrar: ClusterRegistrar;
  let serverSocket: net.Server;
  let connectionSocket: net.Socket;

  before(async () => {
    // Setup a dummy "Cluster Server"
    serverSocket = net.createServer((socket) => {
      connectionSocket = socket;
      socket.on('data', (data) => {
        const len = data.readUInt32BE(0);
        const body = JSON.parse(data.subarray(4, 4 + len).toString('utf8'));
        
        if (body.op === IPC_OP.REGISTER_WORLD) {
          const ack: RegisterWorldAck = { success: true, channelIndex: 0 };
          socket.write(encodeMessage(IPC_OP.REGISTER_WORLD_ACK, ack));
        } else if (body.op === IPC_OP.WORLD_HEARTBEAT) {
          const ack: WorldHeartbeatAck = { ts: body.data.ts };
          socket.write(encodeMessage(IPC_OP.WORLD_HEARTBEAT_ACK, ack));
        }
      });
    });

    await new Promise<void>((resolve) => serverSocket.listen(0, '127.0.0.1', () => resolve()));
    const address = serverSocket.address() as net.AddressInfo;

    registrar = new ClusterRegistrar({
      serverId: 'world-1',
      channelId: 1,
      channelName: 'World 1',
      publicIp: '127.0.0.1',
      publicPort: 38180,
      maxPlayers: 1000,
      ipcSecret: 'test-secret',
      clusterHost: '127.0.0.1',
      clusterInternalPort: address.port,
      reconnectIntervalMs: 1000,
      heartbeatIntervalMs: 1000,
      getPlayerCount: () => 42,
      logger: DUMMY_LOGGER,
    });
  });

  after(async () => {
    await registrar.shutdown();
    if (connectionSocket && !connectionSocket.destroyed) connectionSocket.destroy();
    if (serverSocket) {
      await new Promise<void>((resolve) => serverSocket.close(() => resolve()));
    }
  });

  it('should register successfully and begin heartbeat', async () => {
    // We wait for the 'registered' event
    const registeredPromise = new Promise<void>((resolve) => {
      registrar.once('registered', resolve);
    });

    registrar.start();
    await registeredPromise;

    assert.equal(registrar.isRegistered, true);
  });
});
