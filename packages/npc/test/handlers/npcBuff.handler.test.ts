/**
 * NpcBuffHandler tests -- packet parse + session/rate guard.
 *
 * @module test/handlers/npcBuff.handler
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { NpcBuffHandler } from '../../src/handlers/npcBuff.handler';
import type { NpcBuffService, NpcBuffResult } from '../../src/services/npcBuff.service';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

const payload = (key: string) => {
  const w = new PacketWriter();
  w.writeString(key);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: NpcBuffResult): NpcBuffService =>
  ({ buff: () => r }) as unknown as NpcBuffService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('NpcBuffHandler', () => {
  it('reads the key string and delegates to the service', () => {
    let captured: string | null = null;
    const svc = { buff: (_p: CPlayer, key: string) => { captured = key; return { ok: true, applied: 0, refreshed: 0, replaced: 0, conflicts: 0, skipped: 0 }; } } as unknown as NpcBuffService;
    new NpcBuffHandler(fakePm(player), svc)
      .handleNpcBuff(mockSocket() as never, new PacketReader(payload('MaFl_Helper')));
    assert.equal(captured, 'MaFl_Helper');
  });

  it('destroys when not IN_WORLD', () => {
    const sock = mockSocket(SessionState.CONNECTED);
    new NpcBuffHandler(fakePm(player), fakeSvc({ ok: true, applied: 0, refreshed: 0, replaced: 0, conflicts: 0, skipped: 0 }))
      .handleNpcBuff(sock as never, new PacketReader(payload('MaFl_Helper')));
    assert.equal(sock._destroyed, true);
  });

  it('rejects a key longer than 63 chars (PacketError swallowed)', () => {
    const sock = mockSocket();
    const longKey = 'A'.repeat(64);
    new NpcBuffHandler(fakePm(player), fakeSvc({ ok: true, applied: 0, refreshed: 0, replaced: 0, conflicts: 0, skipped: 0 }))
      .handleNpcBuff(sock as never, new PacketReader(payload(longKey)));
    assert.equal(sock._destroyed, false, 'malformed string: warn + return, no destroy');
  });
});
