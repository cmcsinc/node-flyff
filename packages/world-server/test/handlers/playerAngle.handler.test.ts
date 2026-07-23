import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PlayerAngleHandler } from '../../src/handlers/playerAngle.handler';
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

/** Build the 45-byte PLAYERANGLE body. */
function anglePayload(): Buffer {
  const w = new PacketWriter();
  for (let i = 0; i < 9; i++) w.writeFloat(i);   // v(3) + vd(3) + f + fAngleX + fAccPower
  w.writeFloat(0);                                // fTurnAngle
  w.writeQword(0n);                               // nTickCount
  return w.build();
}

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (): MovementService =>
  ({ applyAngle: () => ({ ok: true, reached: 0 }) }) as unknown as MovementService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('PlayerAngleHandler', () => {
  it('accepts a 45-byte frame and delegates to applyAngle', () => {
    let called = false;
    const svc = { applyAngle: () => { called = true; return { ok: true, reached: 0 }; } } as unknown as MovementService;
    const handler = new PlayerAngleHandler(fakePm(player), svc);
    handler.handlePlayerAngle(mockSocket() as never, new PacketReader(anglePayload()));
    assert.equal(called, true);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new PlayerAngleHandler(fakePm(player), fakeSvc());
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handlePlayerAngle(sock as never, new PacketReader(anglePayload()));
    assert.equal(sock._destroyed, true);
  });

  it('drops on truncated body without destroying', () => {
    const handler = new PlayerAngleHandler(fakePm(player), fakeSvc());
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeFloat(0); // 4 bytes, need 45
    handler.handlePlayerAngle(sock as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, false);
  });
});
