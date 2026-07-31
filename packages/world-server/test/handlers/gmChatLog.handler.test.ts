import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { GmChatLogHandler } from '../../src/handlers/gmChatLog.handler';
import type { GmChatLogService } from '../../src/services/gmChatLog.service';
import type { PlayerManager } from '@flyff/world-core';
import { AUTH } from '@flyff/entities';
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

const payload = (from: string, text: string) => {
  const w = new PacketWriter();
  w.writeString(from);
  w.writeString(text);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;

function spySvc() {
  const calls: Array<[string, string]> = [];
  const svc = { log: (_p: CPlayer, f: string, t: string) => { calls.push([f, t]); } } as unknown as GmChatLogService;
  return { svc, calls };
}

const gmPlayer = (auth: number) =>
  ({ m_idPlayer: 42, m_szName: 'gm', m_bAuthority: auth }) as unknown as CPlayer;

describe('GmChatLogHandler', () => {
  it('logs a reported whisper from an AUTH_LOGCHATTING account', () => {
    const { svc, calls } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.LOGCHATTING)), svc);
    const sock = mockSocket();
    handler.handleGmChatLog(sock as never, new PacketReader(payload('bob', 'hi gm')));
    assert.equal(sock._destroyed, false);
    assert.deepEqual(calls, [['bob', 'hi gm']]);
  });

  it('drops a report from a non-GM account', () => {
    const { svc, calls } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.GENERAL)), svc);
    handler.handleGmChatLog(mockSocket() as never, new PacketReader(payload('bob', 'hi')));
    assert.equal(calls.length, 0);
  });

  it('drops an over-long message (C++ ReadString cap is 260)', () => {
    const { svc, calls } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.ADMINISTRATOR)), svc);
    const sock = mockSocket();
    handler.handleGmChatLog(sock as never, new PacketReader(payload('bob', 'x'.repeat(261))));
    assert.equal(calls.length, 0);
    assert.equal(sock._destroyed, false);
  });

  it('drops an over-long name (MAX_PLAYER is 42)', () => {
    const { svc, calls } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.ADMINISTRATOR)), svc);
    handler.handleGmChatLog(mockSocket() as never, new PacketReader(payload('n'.repeat(43), 'hi')));
    assert.equal(calls.length, 0);
  });

  it('ignores an empty message', () => {
    const { svc, calls } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.ADMINISTRATOR)), svc);
    handler.handleGmChatLog(mockSocket() as never, new PacketReader(payload('bob', '')));
    assert.equal(calls.length, 0);
  });

  it('destroys when not IN_WORLD', () => {
    const { svc } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.ADMINISTRATOR)), svc);
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleGmChatLog(sock as never, new PacketReader(payload('bob', 'hi')));
    assert.equal(sock._destroyed, true);
  });

  it('drops a truncated payload without destroying', () => {
    const { svc, calls } = spySvc();
    const handler = new GmChatLogHandler(fakePm(gmPlayer(AUTH.ADMINISTRATOR)), svc);
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeString('bob'); // second string missing
    handler.handleGmChatLog(sock as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, false);
    assert.equal(calls.length, 0);
  });
});
