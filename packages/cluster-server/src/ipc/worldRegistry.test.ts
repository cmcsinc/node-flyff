import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import net from 'node:net';
import type { Logger } from 'pino';
import { WorldRegistry } from './worldRegistry.js';
import { IPC_OP, computeRegistrationToken, type RegisterWorldRequest, type WorldHeartbeat } from '@flyff/ipc';

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

describe('WorldRegistry', () => {
  let registry: WorldRegistry;
  let clientSocket: net.Socket;

  before(async () => {
    registry = new WorldRegistry({
      serverId: 'cluster-1',
      internalPort: 0, // OS assigned
      allowedWorlds: ['world-1'],
      ipcSecret: 'test-secret',
      heartbeatTimeoutMs: 1000,
      logger: DUMMY_LOGGER,
    });
    await registry.start();
  });

  after(async () => {
    if (clientSocket && !clientSocket.destroyed) {
      clientSocket.destroy();
    }
    await registry.stop();
  });

  it('should accept a valid REGISTER_WORLD request', async () => {
    const port = (registry.server!.address() as net.AddressInfo).port;
    clientSocket = net.createConnection({ port, host: '127.0.0.1' });

    await new Promise<void>((resolve) => clientSocket.once('connect', resolve));

    const token = computeRegistrationToken('test-secret', 'world-1', 'world');
    const req: RegisterWorldRequest = {
      serverId: 'world-1',
      name: 'World 1',
      publicIp: '127.0.0.1',
      publicPort: 38180,
      maxPlayers: 1000,
      channelId: 1,
      registrationToken: token,
    };

    clientSocket.write(encodeMessage(IPC_OP.REGISTER_WORLD, req));

    const data = await new Promise<Buffer>((resolve) => clientSocket.once('data', resolve));
    
    // Parse response
    const len = data.readUInt32BE(0);
    const body = JSON.parse(data.subarray(4, 4 + len).toString('utf8'));
    
    assert.equal(body.op, IPC_OP.REGISTER_WORLD_ACK);
    assert.equal(body.data.success, true);
    assert.equal(body.data.channelIndex, 0);

    const online = registry.getOnlineWorlds();
    assert.equal(online.length, 1);
    assert.equal(online[0]?.serverId, 'world-1');
  });

  it('should handle WORLD_HEARTBEAT', async () => {
    const hb: WorldHeartbeat = {
      serverId: 'world-1',
      players: 42,
      ts: Date.now()
    };
    clientSocket.write(encodeMessage(IPC_OP.WORLD_HEARTBEAT, hb));

    const data = await new Promise<Buffer>((resolve) => clientSocket.once('data', resolve));
    const len = data.readUInt32BE(0);
    const body = JSON.parse(data.subarray(4, 4 + len).toString('utf8'));

    assert.equal(body.op, IPC_OP.WORLD_HEARTBEAT_ACK);
    
    const world = registry.getWorld('world-1');
    assert.ok(world);
    assert.equal(world.players, 42);
  });
});
