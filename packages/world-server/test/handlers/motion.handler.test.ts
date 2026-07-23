import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MotionHandler } from '../../src/handlers/motion.handler';
import type { MotionService } from '../../src/services/motion.service';
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

const motionPayload = (dwMsg: number) => {
  const w = new PacketWriter();
  w.writeDword(dwMsg);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (res: { ok: true; reached: number }): MotionService =>
  ({ motion: () => res }) as unknown as MotionService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('MotionHandler', () => {
  it('delegates a DWORD motion to the service', () => {
    let captured = -1;
    const svc = { motion: (_p: CPlayer, dw: number) => { captured = dw; return { ok: true, reached: 1 }; } } as unknown as MotionService;
    const handler = new MotionHandler(fakePm(player), svc);
    const sock = mockSocket();
    handler.handleMotion(sock as never, new PacketReader(motionPayload(0x42)));
    assert.equal(sock._destroyed, false);
    assert.equal(captured, 0x42);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new MotionHandler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMotion(sock as never, new PacketReader(motionPayload(1)));
    assert.equal(sock._destroyed, true);
  });

  it('drops on truncated payload without destroying', () => {
    const handler = new MotionHandler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeWord(1); // only 2 bytes, need 4
    handler.handleMotion(sock as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, false);
  });
});
