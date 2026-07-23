import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer';
import { SessionState } from '@flyff/core/constants/sessionState';
import { QueryPlayerDataHandler } from '../../src/handlers/queryPlayerData.handler';
import type { QueryPlayerDataService } from '../../src/services/queryPlayerData.service';

function mockSocket(state: number = SessionState.IN_WORLD) {
  let destroyed = false;
  const written: Buffer[] = [];
  const sink = new PacketBuffer();
  return {
    session: { state, charId: 42 },
    write: (b: Buffer) => { sink.push(b); for (const p of sink.drain()) written.push(p); return true; },
    destroy: () => { destroyed = true; },
    _written: written,
    get _destroyed() { return destroyed; },
  };
}

/** Build a QUERY_PLAYER_DATA payload (DPSrvr.cpp:1647 field order). */
function queryPayload(idPlayer: number, nVer: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(idPlayer);
  w.writeLong(nVer);
  return w.build();
}

function fakeService(reply: Buffer | null): QueryPlayerDataService {
  return { query: () => ({ reply }) } as unknown as QueryPlayerDataService;
}

describe('QueryPlayerDataHandler', () => {
  it('parses idPlayer + nVer and writes nothing when the stub returns no reply', async () => {
    const handler = new QueryPlayerDataHandler(fakeService(null));
    const sock = mockSocket();
    await handler.handleQueryPlayerData(sock as unknown as never, new PacketReader(queryPayload(99, 3)));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 0);
  });

  it('sends the reply buffer when the service returns one', async () => {
    const reply = Buffer.from([0xaa, 0xbb]);
    const handler = new QueryPlayerDataHandler(fakeService(reply));
    const sock = mockSocket();
    await handler.handleQueryPlayerData(sock as unknown as never, new PacketReader(queryPayload(99, 3)));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 1);
    assert.deepEqual(sock._written[0], reply);
  });

  it('destroys when the socket is not IN_WORLD', async () => {
    const handler = new QueryPlayerDataHandler(fakeService(null));
    const sock = mockSocket(SessionState.CONNECTED);
    await handler.handleQueryPlayerData(sock as unknown as never, new PacketReader(queryPayload(99, 3)));
    assert.equal(sock._destroyed, true);
  });

  it('destroys on a truncated payload', async () => {
    const handler = new QueryPlayerDataHandler(fakeService(null));
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeDword(99); // missing nVer
    await handler.handleQueryPlayerData(sock as unknown as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, true);
  });
});
