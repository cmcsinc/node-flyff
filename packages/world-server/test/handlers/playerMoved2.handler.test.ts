import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PlayerMoved2Handler } from '../../src/handlers/playerMoved2.handler';
import type { MovementService, MovementOutcome } from '../../src/services/movement.service';
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

/** Build the 73-byte PLAYERMOVED2 body. */
function moved2Payload(): Buffer {
  const w = new PacketWriter();
  for (let i = 0; i < 6; i++) w.writeFloat(i);    // v + vd
  w.writeFloat(0);                                 // f
  w.writeFloat(0);                                 // fAngleX
  w.writeFloat(0);                                 // fAccPower
  w.writeFloat(0);                                 // fTurnAngle
  for (let i = 0; i < 3; i++) w.writeDword(i);     // dwState/Flag/Motion
  w.writeLong(0);                                  // nMotionEx
  w.writeLong(0);                                  // nLoop
  w.writeDword(0);                                 // dwMotionOption
  w.writeQword(0n);                                // nTickCount
  w.writeByte(0);                                  // nFrame
  return w.build();
}

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: MovementOutcome): MovementService =>
  ({ applyMoved2: () => r }) as unknown as MovementService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('PlayerMoved2Handler', () => {
  it('delegates a 73-byte frame to movement.applyMoved2', () => {
    let called = false;
    const svc = { applyMoved2: () => { called = true; return { ok: true, reached: 0 }; } } as unknown as MovementService;
    const handler = new PlayerMoved2Handler(fakePm(player), svc);
    handler.handlePlayerMoved2(mockSocket() as never, new PacketReader(moved2Payload()));
    assert.equal(called, true);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new PlayerMoved2Handler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handlePlayerMoved2(sock as never, new PacketReader(moved2Payload()));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on anti-teleport reject', () => {
    const handler = new PlayerMoved2Handler(fakePm(player), fakeSvc({ ok: false, reason: 'too_far' }));
    const sock = mockSocket();
    handler.handlePlayerMoved2(sock as never, new PacketReader(moved2Payload()));
    assert.equal(sock._destroyed, false);
  });
});
