import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { QueryGetDestObjHandler } from '../../src/handlers/queryGetDestObj.handler';
import type { QueryGetDestObjService } from '../../src/services/queryGetDestObj.service';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  const written: Buffer[] = [];
  return {
    session: { state, charId: 42 },
    write: (buf: Buffer) => { written.push(buf); return true; },
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
    get _written() { return written; },
  };
}

const payload = (objid: number) => {
  const w = new PacketWriter();
  w.writeDword(objid);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('QueryGetDestObjHandler', () => {
  it('passes objid to the service and writes back the reply', () => {
    const reply = Buffer.from([0xaa]);
    let captured = -1;
    const svc = {
      query: (_p: CPlayer, id: number) => { captured = id; return { reply }; },
    } as unknown as QueryGetDestObjService;
    const sock = mockSocket();
    const handler = new QueryGetDestObjHandler(fakePm(player), svc);
    handler.handleQueryGetDestObj(sock as never, new PacketReader(payload(0x1234)));
    assert.equal(captured, 0x1234);
    assert.equal(sock._written.length, 1);
    // sendPacket frames: [0x5E][size DWORD][payload]. Reply byte sits after the 5-byte frame.
    assert.equal(sock._written[0]![0], 0x5e);
    assert.equal(sock._written[0]![5], 0xaa);
  });

  it('writes nothing when the service has no reply', () => {
    const svc = { query: () => ({}) } as unknown as QueryGetDestObjService;
    const sock = mockSocket();
    const handler = new QueryGetDestObjHandler(fakePm(player), svc);
    handler.handleQueryGetDestObj(sock as never, new PacketReader(payload(0x9999)));
    assert.equal(sock._written.length, 0);
  });

  it('destroys when not IN_WORLD', () => {
    const svc = { query: () => ({}) } as unknown as QueryGetDestObjService;
    const sock = mockSocket(SessionState.CONNECTED);
    const handler = new QueryGetDestObjHandler(fakePm(player), svc);
    handler.handleQueryGetDestObj(sock as never, new PacketReader(payload(1)));
    assert.equal(sock._destroyed, true);
  });

  it('destroys when the player is missing', () => {
    const svc = { query: () => ({}) } as unknown as QueryGetDestObjService;
    const sock = mockSocket();
    const handler = new QueryGetDestObjHandler(fakePm(undefined), svc);
    handler.handleQueryGetDestObj(sock as never, new PacketReader(payload(1)));
    assert.equal(sock._destroyed, true);
  });

  it('survives a truncated payload (parse failure caught, not destroyed)', () => {
    const svc = { query: () => ({}) } as unknown as QueryGetDestObjService;
    const sock = mockSocket();
    const handler = new QueryGetDestObjHandler(fakePm(player), svc);
    const w = new PacketWriter();
    w.writeWord(1); // 2 bytes, need 4
    handler.handleQueryGetDestObj(sock as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 0);
  });
});
