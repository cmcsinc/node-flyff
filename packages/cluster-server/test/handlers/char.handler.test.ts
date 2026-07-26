import { describe, it, before, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { CharHandler } from '../../src/handlers/char.handler';
import { PlayerListSerializer } from '../../src/net/playerList.serializer';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer';
import type { Socket } from 'node:net';

function makeMockSocket(): Socket & { _written: Buffer[] } {
  const written: Buffer[] = [];
  const sink = new PacketBuffer();
  return {
    remoteAddress: '127.0.0.1',
    write: (buf: Buffer) => { sink.push(buf); for (const p of sink.drain()) written.push(p); return true; },
    destroy: () => {},
    once: () => {},
    _written: written,
  } as unknown as Socket & { _written: Buffer[] };
}

const noKickConnections = { bind: () => null } as any;
const cacheAddrSource = { getCacheAddr: () => '10.0.0.5' };

describe('CharHandler', () => {
  let handler: CharHandler;
  let listService: any;
  let createService: any;
  let selectService: any;

  before(() => {
    listService = { listByAccount: async () => [] };
    createService = { create: async () => ({ ok: true, charId: 1 }), delete: async () => ({ ok: true }) };
    selectService = { prejoin: async () => ({ ok: true, charId: 77, token: 'tok' }) };
    handler = new CharHandler(listService, createService, selectService, new PlayerListSerializer(), noKickConnections, cacheAddrSource);
  });

  describe('handleGetPlayerList()', () => {
    it('replies with a PLAYER_LIST packet', async () => {
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('2023');   // version
      w.writeDword(0x1234);   // authKey
      w.writeString('alice'); // account
      w.writeString('pw');    // password
      w.writeDword(0);        // dwId
      await handler.handleGetPlayerList(socket, new PacketReader(w.build()));
      // CACHE_ADDR (0xf2), LOGIN_PROTECT_NUMPAD (0x88100200), PLAYER_LIST --
      // mirrors C++ DPLoginSrvr.cpp:167-170.
      assert.equal(socket._written.length, 3);
      const cacheReader = new PacketReader(socket._written[0]!);
      assert.equal(cacheReader.readDword(), PACKETTYPE.CACHE_ADDR);
      assert.equal(cacheReader.readString(), '10.0.0.5');
      const numPadReader = new PacketReader(socket._written[1]!);
      assert.equal(numPadReader.readDword(), PACKETTYPE.LOGIN_PROTECT_NUMPAD);
      const idNumPad = numPadReader.readDword();
      assert.ok(idNumPad >= 0 && idNumPad < 1000, `idNumPad in range: ${idNumPad}`);
      assert.equal(new PacketReader(socket._written[2]!).readDword(), PACKETTYPE.PLAYER_LIST);
    });

    it('sends a different numpad id on each GETPLAYERLIST', async () => {
      const ids = new Set<number>();
      for (let i = 0; i < 6; i++) {
        const socket = makeMockSocket();
        const w = new PacketWriter();
        w.writeString('2023'); w.writeDword(0x1234); w.writeString('alice'); w.writeString('pw'); w.writeDword(0);
        await handler.handleGetPlayerList(socket, new PacketReader(w.build()));
        const reader = new PacketReader(socket._written[1]!);
        reader.readDword(); // opcode
        ids.add(reader.readDword());
      }
      // Random over 0-999 -- 6 draws colliding to a single value is astronomically unlikely.
      assert.ok(ids.size > 1, `expected >1 distinct numpad id, got ${ids.size}`);
    });

    it('drops the request silently when authKey is 0', async () => {
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('2023');
      w.writeDword(0); // zero auth key
      w.writeString('alice');
      w.writeString('pw');
      w.writeDword(0);
      await handler.handleGetPlayerList(socket, new PacketReader(w.build()));
      assert.equal(socket._written.length, 0);
    });
  });

  describe('handleCreatePlayer()', () => {
    beforeEach(() => { createService.create = async () => ({ ok: true, charId: 5 }); });

    it('replies with PLAYER_LIST on success', async () => {
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('alice'); w.writeString('pw');
      w.writeByte(0); w.writeString('NewHero');
      w.writeByte(0); w.writeByte(0); w.writeByte(4); w.writeByte(1); // face,costume,skinSet,hairMesh
      w.writeDword(2);                                          // hairColor
      w.writeByte(0); w.writeByte(0); w.writeByte(3);          // sex,job,headMesh
      w.writeLong(0);                                          // bankPW
      w.writeDword(0x1234);                                    // authKey
      await handler.handleCreatePlayer(socket, new PacketReader(w.build()));
      assert.equal(socket._written.length, 1);
      assert.equal(new PacketReader(socket._written[0]!).readDword(), PACKETTYPE.PLAYER_LIST);
    });

    it('replies with ERROR on failure', async () => {
      createService.create = async () => ({ ok: false, errorCode: 111 });
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('alice'); w.writeString('pw');
      w.writeByte(0); w.writeString('bad!');
      w.writeByte(0); w.writeByte(0); w.writeByte(0); w.writeByte(0);
      w.writeDword(0);
      w.writeByte(0); w.writeByte(0); w.writeByte(0);
      w.writeLong(0);
      w.writeDword(0x1234);
      await handler.handleCreatePlayer(socket, new PacketReader(w.build()));
      assert.equal(socket._written.length, 1);
      const reader = new PacketReader(socket._written[0]!);
      assert.equal(reader.readDword(), PACKETTYPE.ERROR);
      assert.equal(reader.readDword(), 111);
    });
  });

  describe('handleDeletePlayer()', () => {
    beforeEach(() => { createService.delete = async () => ({ ok: true }); });

    it('replies with PLAYER_LIST on success', async () => {
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('alice'); w.writeString('pw'); w.writeString('delkey');
      w.writeDword(5); w.writeDword(0x1234);
      await handler.handleDeletePlayer(socket, new PacketReader(w.build()));
      assert.equal(socket._written.length, 1);
      assert.equal(new PacketReader(socket._written[0]!).readDword(), PACKETTYPE.PLAYER_LIST);
    });

    it('replies with ERROR on failure', async () => {
      createService.delete = async () => ({ ok: false, errorCode: 113 });
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('alice'); w.writeString('pw'); w.writeString('delkey');
      w.writeDword(5); w.writeDword(0x1234);
      await handler.handleDeletePlayer(socket, new PacketReader(w.build()));
      const reader = new PacketReader(socket._written[0]!);
      assert.equal(reader.readDword(), PACKETTYPE.ERROR);
      assert.equal(reader.readDword(), 113);
    });
  });

  describe('handlePreJoin()', () => {
    beforeEach(() => { selectService.prejoin = async () => ({ ok: true, charId: 77, token: 'tok' }); });

    it('replies with a bare PRE_JOIN opcode on success', async () => {
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('alice'); w.writeDword(77); w.writeString('Hero'); w.writeLong(0);
      await handler.handlePreJoin(socket, new PacketReader(w.build()));
      assert.equal(socket._written.length, 1);
      assert.equal(new PacketReader(socket._written[0]!).readDword(), PACKETTYPE.PRE_JOIN);
    });

    it('sends nothing on failure', async () => {
      selectService.prejoin = async () => ({ ok: false });
      const socket = makeMockSocket();
      const w = new PacketWriter();
      w.writeString('alice'); w.writeDword(77); w.writeString('Hero'); w.writeLong(0);
      await handler.handlePreJoin(socket, new PacketReader(w.build()));
      assert.equal(socket._written.length, 0);
    });
  });
});
