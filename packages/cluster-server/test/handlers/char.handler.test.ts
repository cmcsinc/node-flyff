import { describe, it, before, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { CharHandler } from '../../src/handlers/char.handler.js';
import { PlayerListSerializer } from '../../src/net/playerList.serializer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer.js';
import type { Socket } from 'node:net';

function makeMockSocket(): Socket & { _written: Buffer[] } {
  const written: Buffer[] = [];
  const sink = new PacketBuffer();
  return {
    remoteAddress: '127.0.0.1',
    write: (buf: Buffer) => { sink.push(buf); for (const p of sink.drain()) written.push(p); return true; },
    destroy: () => {},
    _written: written,
  } as unknown as Socket & { _written: Buffer[] };
}

describe('CharHandler', () => {
  let handler: CharHandler;
  let listService: any;
  let createService: any;
  let selectService: any;

  before(() => {
    listService = { listByAccount: async () => [] };
    createService = { create: async () => ({ ok: true, charId: 1 }), delete: async () => ({ ok: true }) };
    selectService = { prejoin: async () => ({ ok: true, charId: 77, token: 'tok' }) };
    handler = new CharHandler(listService, createService, selectService, new PlayerListSerializer());
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
      assert.equal(socket._written.length, 1);
      assert.equal(new PacketReader(socket._written[0]!).readDword(), PACKETTYPE.PLAYER_LIST);
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
