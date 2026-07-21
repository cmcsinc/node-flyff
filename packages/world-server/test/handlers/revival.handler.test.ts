import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { RevivalHandler } from '../../src/handlers/revival.handler.js';
import type { RevivalService, RevivalOutcome, RevivalType } from '../../src/services/revival.service.js';
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

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: RevivalOutcome): RevivalService =>
  ({ revive: () => r }) as unknown as RevivalService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

/** REVIVAL has no body; PacketReader rejects empty buffers so write a placeholder byte. */
const emptyBody = () => { const w = new PacketWriter(); w.writeByte(0); return w.build(); };

/** Captures the type the handler forwarded to the service. */
function captureSvc(): { svc: RevivalService; calls: RevivalType[] } {
  const calls: RevivalType[] = [];
  const svc = {
    revive: (_p: CPlayer, type: RevivalType) => { calls.push(type); return { ok: true }; },
  } as unknown as RevivalService;
  return { svc, calls };
}

describe('RevivalHandler', () => {
  it('handleRevival forwards SCROLL on empty body', () => {
    const { svc, calls } = captureSvc();
    const handler = new RevivalHandler(fakePm(player), svc);
    handler.handleRevival(mockSocket() as never, new PacketReader(emptyBody()));
    assert.deepEqual(calls, ['SCROLL']);
  });

  it('handleRevivalLodestar forwards LODESTAR', () => {
    const { svc, calls } = captureSvc();
    const handler = new RevivalHandler(fakePm(player), svc);
    handler.handleRevivalLodestar(mockSocket() as never, new PacketReader(emptyBody()));
    assert.deepEqual(calls, ['LODESTAR']);
  });

  it('handleRevivalLodelight forwards LODELIGHT', () => {
    const { svc, calls } = captureSvc();
    const handler = new RevivalHandler(fakePm(player), svc);
    handler.handleRevivalLodelight(mockSocket() as never, new PacketReader(emptyBody()));
    assert.deepEqual(calls, ['LODELIGHT']);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new RevivalHandler(fakePm(player), fakeSvc({ ok: true }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleRevival(sock as never, new PacketReader(emptyBody()));
    assert.equal(sock._destroyed, true);
  });

  it('does not destroy on not_dead reject (logged at warn)', () => {
    const handler = new RevivalHandler(fakePm(player), fakeSvc({ ok: false, reason: 'not_dead' }));
    const sock = mockSocket();
    handler.handleRevival(sock as never, new PacketReader(emptyBody()));
    assert.equal(sock._destroyed, false);
  });
});
