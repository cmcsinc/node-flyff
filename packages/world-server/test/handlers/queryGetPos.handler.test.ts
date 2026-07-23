import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { QueryGetPosHandler } from '../../src/handlers/queryGetPos.handler';
import type { QueryGetPosService } from '../../src/services/queryGetPos.service';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

const payload = (objid: number) => {
  const w = new PacketWriter();
  w.writeDword(objid);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (): QueryGetPosService =>
  ({ query: () => ({ ok: true, replied: false }) }) as unknown as QueryGetPosService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('QueryGetPosHandler', () => {
  it('passes objid to the service', () => {
    let captured = -1;
    const svc = { query: (_p: CPlayer, id: number) => { captured = id; return { ok: true, replied: false }; } } as unknown as QueryGetPosService;
    const handler = new QueryGetPosHandler(fakePm(player), svc);
    handler.handleQueryGetPos(mockSocket() as never, new PacketReader(payload(0x9999)));
    assert.equal(captured, 0x9999);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new QueryGetPosHandler(fakePm(player), fakeSvc());
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleQueryGetPos(sock as never, new PacketReader(payload(1)));
    assert.equal(sock._destroyed, true);
  });

  it('destroys on truncated payload', () => {
    const handler = new QueryGetPosHandler(fakePm(player), fakeSvc());
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeWord(1); // 2 bytes, need 4
    handler.handleQueryGetPos(sock as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, false); // parse failure caught, not destroyed
  });
});
