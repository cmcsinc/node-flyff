import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { ServerListHandler } from '../../src/handlers/serverList.handler.js';
import type { ServerListService, ServerListEntry } from '../../src/services/serverList.service.js';

function mockSocket() {
  const written: Buffer[] = [];
  const sink = new PacketBuffer();
  return {
    write: (b: Buffer) => { sink.push(b); for (const p of sink.drain()) written.push(p); return true; },
    _written: written,
  } as unknown as Socket & { _written: Buffer[] };
}

function fakeService(servers: ServerListEntry[]): ServerListService {
  return { getServerList: () => servers } as unknown as ServerListService;
}

const ENTRY: ServerListEntry = {
  name: 'Glaphan', ip: '127.0.0.1', port: 28000, players: 42, maxPlayers: 1000,
  channelCount: 1, status: 'online', channels: [],
};

describe('ServerListHandler — v15 SRVR_LIST layout', () => {
  it('writes [dwAuthKey][cbAccountFlag][count] + per-server 7 fields', async () => {
    const handler = new ServerListHandler(fakeService([ENTRY]));
    const sock = mockSocket();
    await handler.sendServerList(sock, 1);

    const buf = sock._written[0]!;
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SRVR_LIST);
    assert.ok(buf.readUInt32LE(4) > 0, 'dwAuthKey must be non-zero');
    assert.equal(buf.readUInt8(8), 0);            // cbAccountFlag
    assert.equal(buf.readUInt32LE(9), 1);         // dwSizeofServerset

    let o = 13;
    assert.equal(buf.readUInt32LE(o), 0); o += 4;  // dwParent
    assert.equal(buf.readUInt32LE(o), 1); o += 4;  // dwID
    assert.equal(buf.readUInt32LE(o), 7); o += 4;  // name length
    assert.equal(buf.subarray(o, o + 7).toString('ascii'), 'Glaphan'); o += 7;
    assert.equal(buf.readUInt32LE(o), 9); o += 4;  // addr length
    assert.equal(buf.subarray(o, o + 9).toString('ascii'), '127.0.0.1'); o += 9;
    assert.equal(buf.readUInt32LE(o), 0); o += 4;  // b18 (BOOL, 4 bytes)
    assert.equal(buf.readUInt32LE(o), 42); o += 4; // lCount (players)
    assert.equal(buf.readUInt32LE(o), 1); o += 4;  // lEnable (online)
    assert.equal(buf.readUInt32LE(o), 1000); o += 4; // lMax
    assert.equal(o, buf.length, 'no trailing bytes');
  });

  it('emits zero servers cleanly (count=0, no per-server block)', async () => {
    const handler = new ServerListHandler(fakeService([]));
    const sock = mockSocket();
    await handler.sendServerList(sock, 1);
    const buf = sock._written[0]!;
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SRVR_LIST);
    assert.ok(buf.readUInt32LE(4) > 0);
    assert.equal(buf.readUInt8(8), 0);
    assert.equal(buf.readUInt32LE(9), 0);
    assert.equal(buf.length, 13);
  });
});
