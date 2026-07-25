/**
 * ReqLeaveHandler test -- REQ_LEAVE (0x00ff00fa) is bodyless; the handler sets
 * `m_dwLeavePenatyTime` idempotently and destroys on bad session / missing player.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SessionState } from '@flyff/core/constants/sessionState';
import { ReqLeaveHandler } from '../../src/handlers/reqLeave.handler';
import type { PlayerManager } from '@flyff/world-core';

function makeHandler() {
  const player = { m_idPlayer: 0xcccc, m_dwLeavePenatyTime: 0 };
  const playerManager = { get: () => player } as unknown as PlayerManager;
  const handler = new ReqLeaveHandler(playerManager);
  return { handler, player };
}

function mockSocket(state = SessionState.IN_WORLD, charId = 1) {
  let destroyed = false;
  return {
    session: { state, charId },
    destroy: () => { destroyed = true; },
    _destroyed: () => destroyed,
  } as unknown as ReturnType<typeof mockSocket> & { _destroyed(): boolean };
}

describe('ReqLeaveHandler', () => {
  it('sets m_dwLeavePenatyTime to ~now+10s on first REQ_LEAVE', () => {
    const { handler, player } = makeHandler();
    const before = Date.now();
    handler.handleReqLeave(mockSocket());
    const after = Date.now();
    assert.ok(player.m_dwLeavePenatyTime > 0, 'penalty timestamp set');
    assert.ok(
      player.m_dwLeavePenatyTime >= before + 9_900 && player.m_dwLeavePenatyTime <= after + 10_100,
      `penalty ≈ now+10s (got ${player.m_dwLeavePenatyTime}, now≈${before})`,
    );
  });

  it('is idempotent -- a second REQ_LEAVE does not move the deadline', () => {
    const { handler, player } = makeHandler();
    handler.handleReqLeave(mockSocket());
    const first = player.m_dwLeavePenatyTime;
    handler.handleReqLeave(mockSocket());
    assert.equal(player.m_dwLeavePenatyTime, first, 'deadline unchanged on repeat');
  });

  it('destroys when session is not IN_WORLD', () => {
    const { handler, player } = makeHandler();
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleReqLeave(sock);
    assert.equal(sock._destroyed(), true);
    assert.equal(player.m_dwLeavePenatyTime, 0, 'penalty not set on bad state');
  });

  it('destroys when player is not live', () => {
    const playerManager = { get: () => null } as unknown as PlayerManager;
    const handler = new ReqLeaveHandler(playerManager);
    const sock = mockSocket();
    handler.handleReqLeave(sock);
    assert.equal(sock._destroyed(), true);
  });
});
