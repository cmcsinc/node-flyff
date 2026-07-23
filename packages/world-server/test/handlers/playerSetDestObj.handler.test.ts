import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PlayerSetDestObjHandler } from '../../src/handlers/playerSetDestObj.handler';
import type { MovementService } from '../../src/services/movement.service';
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

const payload = (objid: number, fRange: number) => {
  const w = new PacketWriter();
  w.writeDword(objid);
  w.writeFloat(fRange);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('PlayerSetDestObjHandler', () => {
  it('passes objid + fRange to movement.applySetDestObj', () => {
    let got: { id: number; range: number } | null = null;
    const svc = {
      applySetDestObj: (_p: CPlayer, id: number, range: number) => { got = { id, range }; return { ok: true, reached: 0 }; },
    } as unknown as MovementService;
    const handler = new PlayerSetDestObjHandler(fakePm(player), svc);
    handler.handlePlayerSetDestObj(mockSocket() as never, new PacketReader(payload(0x40000001, 1.5)));
    assert.deepEqual(got, { id: 0x40000001, range: 1.5 });
  });

  it('destroys when not IN_WORLD', () => {
    const svc = { applySetDestObj: () => ({ ok: true, reached: 0 }) } as unknown as MovementService;
    const handler = new PlayerSetDestObjHandler(fakePm(player), svc);
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handlePlayerSetDestObj(sock as never, new PacketReader(payload(1, 1)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on non-finite fRange', () => {
    let called = false;
    const svc = { applySetDestObj: () => { called = true; return { ok: true, reached: 0 }; } } as unknown as MovementService;
    const handler = new PlayerSetDestObjHandler(fakePm(player), svc);
    const sock = mockSocket();
    // NaN float payload
    const w = new PacketWriter();
    w.writeDword(1);
    w.writeFloat(NaN);
    handler.handlePlayerSetDestObj(sock as never, new PacketReader(w.build()));
    assert.equal(called, false);
    assert.equal(sock._destroyed, false);
  });
});
