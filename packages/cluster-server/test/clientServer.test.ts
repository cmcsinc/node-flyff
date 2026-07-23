import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildClusterClientServer } from '../src/clientServer';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { CharHandler } from '../src/handlers/char.handler';

describe('buildClusterClientServer', () => {
  it('registers the four character-packet opcodes', () => {
    const fake = {
      handleGetPlayerList: () => {}, handleCreatePlayer: () => {},
      handleDeletePlayer: () => {}, handlePreJoin: () => {},
    } as unknown as CharHandler;
    const { dispatcher, server } = buildClusterClientServer({ charHandler: fake });
    assert.equal(dispatcher.hasHandler(PACKETTYPE.GETPLAYERLIST), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CREATE_PLAYER), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.DELETE_PLAYER), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.PRE_JOIN), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CERTIFY), false);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.JOIN), false);
    server.close();
  });

  it('registers QUERYTICKCOUNT and echoes the client tick back', async () => {
    const fake = {
      handleGetPlayerList: () => {}, handleCreatePlayer: () => {},
      handleDeletePlayer: () => {}, handlePreJoin: () => {},
    } as unknown as CharHandler;
    const { dispatcher } = buildClusterClientServer({ charHandler: fake });

    const written: Buffer[] = [];
    const socket = { write: (b: Buffer) => { written.push(b); return true; } } as never;

    // DPID(4) + opcode(4) + dwTime(4) -- cluster server packets lead with DPID.
    const body = Buffer.alloc(12);
    body.writeUInt32LE(0, 0);                          // DPID_UNKNOWN
    body.writeUInt32LE(PACKETTYPE.QUERYTICKCOUNT, 4);  // opcode
    body.writeUInt32LE(0x11223344, 8);                 // dwTime
    await (dispatcher as unknown as {
      dispatch: (s: unknown, p: Buffer) => Promise<void>;
    }).dispatch(socket, body);

    assert.equal(written.length, 1);
    // sendPacket frames with a 5-byte header ([0x5E][size DWORD]); payload starts
    // at offset 5. Payload = opcode(4) + dwTime(4) + tickQword(8).
    const payload = written[0].subarray(5);
    assert.equal(payload.readUInt32LE(0), PACKETTYPE.QUERYTICKCOUNT);
    assert.equal(payload.readUInt32LE(4), 0x11223344);
    assert.equal(payload.length, 16);
  });
});
