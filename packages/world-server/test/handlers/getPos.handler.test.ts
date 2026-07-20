import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { GetPosHandler } from '../../src/handlers/getPos.handler.js';
import type { MovementService, GetPosOutcome } from '../../src/services/movement.service.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { CPlayer } from '../../src/entities/player.js';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

const payload = (x: number, y: number, z: number, angle: number, objid: number) => {
  const w = new PacketWriter();
  w.writeFloat(x); w.writeFloat(y); w.writeFloat(z);
  w.writeFloat(angle);
  w.writeDword(objid);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: GetPosOutcome): MovementService =>
  ({ applyGetPos: () => r }) as unknown as MovementService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('GetPosHandler', () => {
  it('passes pos + angle + objid to movement.applyGetPos', () => {
    let captured: { x: number; y: number; z: number; a: number; id: number } | null = null;
    const svc = {
      applyGetPos: (_p: CPlayer, pos: { x: number; y: number; z: number }, a: number, id: number) => {
        captured = { ...pos, a, id };
        return { ok: true };
      },
    } as unknown as MovementService;
    const handler = new GetPosHandler(fakePm(player), svc);
    handler.handleGetPos(mockSocket() as never, new PacketReader(payload(1, 2, 3, 0.5, 0xffffffff)));
    assert.deepEqual(captured, { x: 1, y: 2, z: 3, a: 0.5, id: 0xffffffff });
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new GetPosHandler(fakePm(player), fakeSvc({ ok: true }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleGetPos(sock as never, new PacketReader(payload(0, 0, 0, 0, 0)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on NaN-angle reject', () => {
    const handler = new GetPosHandler(fakePm(player), fakeSvc({ ok: false, reason: 'nan_angle' }));
    const sock = mockSocket();
    handler.handleGetPos(sock as never, new PacketReader(payload(0, 0, 0, NaN, 0)));
    assert.equal(sock._destroyed, false);
  });
});
