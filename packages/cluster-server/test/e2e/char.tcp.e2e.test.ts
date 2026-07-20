import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import net, { type Server, type Socket } from 'node:net';

import { createDb, AccountRepository, CharacterRepository } from '@flyff/database';
import { up, down } from '@flyff/database/migrations/001_initial';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer.js';
import { framePacketCrc } from '@flyff/core/net/crcFrame.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';

import { CharHandler } from '../../src/handlers/char.handler.js';
import { CharListService } from '../../src/services/charList.service.js';
import { PlayerListSerializer } from '../../src/net/playerList.serializer.js';
import { AccountConnectionManager } from '../../src/managers/accountConnection.manager.js';
import { buildClusterClientServer } from '../../src/clientServer.js';

/**
 * Cluster (LoginServer-role) path over real TCP, matching the REAL client flow:
 * server SENDS the plain-framed protocolId hello on accept; client adopts it and
 * CRC-frames all its packets. `BEFORESENDSOLE` prepends a DPID DWORD before the
 * opcode. Client sends GETPLAYERLIST; server replies plain-framed PLAYER_LIST.
 */

const ACCOUNT = 'cluser';
const PROTOCOL_VERSION = '20100412';

/**
 * CRC-framed cluster packet: `[DPID 0xFFFFFFFF][opcode][post-opcode body]`,
 * framed with `protocolId`. The dispatcher skips the DPID + opcode.
 */
function clusterFrame(opcode: number, body: Buffer, protocolId: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(0xffffffff); // DPID_UNKNOWN (BEFORESENDSOLE)
  w.writeDword(opcode);
  w.writeBytes(body);
  return framePacketCrc(w.build(), protocolId);
}

describe('Cluster TCP smoke (CRC + DPID prefix + GETPLAYERLIST)', () => {
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let port: number;

  /**
   * Connect + read the server's plain-framed protocolId hello. Returns the
   * socket, adopted protocolId, and the rx PacketBuffer for reading replies.
   */
  async function handshake(): Promise<{ sock: Socket; protocolId: number; rx: PacketBuffer }> {
    const sock = await new Promise<Socket>((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s));
    });
    sock.unref();
    const rx = new PacketBuffer();
    const protocolId = await new Promise<number>((resolve, reject) => {
      const onData = (c: Buffer) => {
        rx.push(c);
        const frames = rx.drain();
        if (frames.length > 0) { sock.off('data', onData); resolve(frames[0]!.readUInt32LE(4)); }
      };
      sock.on('data', onData);
      setTimeout(() => { sock.off('data', onData); reject(new Error('no hello')); }, 2000);
    });
    return { sock, protocolId, rx };
  }

  before(async () => {
    db = createDb({ client: 'better-sqlite3', connection: ':memory:' });
    await up(db);
    const accountRepo = new AccountRepository(db);
    const charRepo = new CharacterRepository(db);
    const accountId = await accountRepo.create({
      username: ACCOUNT, password_hash: 'x', email: 'c@e.com',
      banned: false, banned_until: null,
    } as never);
    await charRepo.create({
      account_id: accountId, name: 'Hero', slot: 0, class: 1, gender: 0,
      hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
      exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
      strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
      x: 0, y: 0, z: 0, world_id: 'W1', zone_id: 1,
    });

    const charList = new CharListService(accountRepo, charRepo);
    const stub = new Proxy({}, { get: () => async () => ({ ok: false }) }) as never;
    const charHandler = new CharHandler(
      charList, stub, stub, new PlayerListSerializer(),
      new AccountConnectionManager(),
      { getCacheAddr: () => '127.0.0.1' },
    );

    server = buildClusterClientServer({ charHandler }).server;
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    server.unref();
    port = (server.address() as net.AddressInfo).port;
  });

  after(async () => {
    await down(db);
    await db.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('replies with a plain-framed PLAYER_LIST for a GETPLAYERLIST', async () => {
    const { sock, protocolId, rx } = await handshake();

    const body = new PacketWriter()
      .writeString(PROTOCOL_VERSION)
      .writeDword(0xdeadbeef)
      .writeString(ACCOUNT)
      .writeString('pw')
      .writeDword(1)
      .build();

    const replies = await new Promise<Buffer[]>((resolve) => {
      const onData = (c: Buffer) => {
        rx.push(c);
        const frames = rx.drain();
        if (frames.length >= 2) { sock.off('data', onData); resolve(frames); }
      };
      sock.on('data', onData);
      setTimeout(() => { sock.off('data', onData); resolve(rx.drain()); }, 2000);
      sock.write(clusterFrame(PACKETTYPE.GETPLAYERLIST, body, protocolId));
    });
    sock.destroy();

    // First frame is CACHE_ADDR (0xf2), second is PLAYER_LIST — mirrors C++
    // DPLoginSrvr.cpp:167 which sends the cache address before the player list.
    assert.ok(replies.length >= 2, 'cluster must reply with CACHE_ADDR then PLAYER_LIST');
    assert.equal(replies[0]!.readUInt32LE(0), PACKETTYPE.CACHE_ADDR);
    assert.equal(replies[1]!.readUInt32LE(0), PACKETTYPE.PLAYER_LIST);
  });

  it('does not reply when the leading DPID is missing (opcode misread)', async () => {
    const { sock, protocolId, rx } = await handshake();

    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.GETPLAYERLIST);
    w.writeString(PROTOCOL_VERSION);
    w.writeDword(0xdeadbeef);
    w.writeString(ACCOUNT);
    w.writeString('pw');
    w.writeDword(1);
    sock.write(framePacketCrc(w.build(), protocolId));

    // The hello was already consumed by handshake(); any further frame = a reply.
    const gotReply = await new Promise<boolean>((resolve) => {
      const onData = (c: Buffer) => {
        rx.push(c);
        if (rx.drain().length > 0) resolve(true);
      };
      sock.on('data', onData);
      setTimeout(() => { sock.off('data', onData); resolve(false); }, 500);
    });
    sock.destroy();
    assert.equal(gotReply, false, 'no reply expected when the DPID prefix is absent');
  });
});
