import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PlayerCorrHandler } from '../../src/handlers/playerCorr.handler.js';
import type { MovementService, MovementOutcome } from '../../src/services/movement.service.js';
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

/** Build the 60-byte PLAYERCORR body (same shape as PLAYERMOVED). */
function corrPayload(): Buffer {
  const w = new PacketWriter();
  for (let i = 0; i < 6; i++) w.writeFloat(i);   // v(3) + vd(3)
  w.writeFloat(0.5);                              // f
  for (let i = 0; i < 3; i++) w.writeDword(i);    // dwState/Flag/Motion
  w.writeLong(0);                                 // nMotionEx
  w.writeLong(0);                                 // nLoop
  w.writeDword(0);                                // dwMotionOption
  w.writeQword(0n);                               // nTickCount
  return w.build();
}

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: MovementOutcome): MovementService =>
  ({ applyCorr: () => r }) as unknown as MovementService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('PlayerCorrHandler', () => {
  it('delegates a 60-byte frame to movement.applyCorr', () => {
    let called = false;
    const svc = { applyCorr: () => { called = true; return { ok: true, reached: 0 }; } } as unknown as MovementService;
    const handler = new PlayerCorrHandler(fakePm(player), svc);
    handler.handlePlayerCorr(mockSocket() as never, new PacketReader(corrPayload()));
    assert.equal(called, true);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new PlayerCorrHandler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handlePlayerCorr(sock as never, new PacketReader(corrPayload()));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on anti-teleport reject', () => {
    const handler = new PlayerCorrHandler(fakePm(player), fakeSvc({ ok: false, reason: 'too_far' }));
    const sock = mockSocket();
    handler.handlePlayerCorr(sock as never, new PacketReader(corrPayload()));
    assert.equal(sock._destroyed, false);
  });
});
