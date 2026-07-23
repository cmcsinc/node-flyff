import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { ChatHandler } from '../../src/handlers/chat.handler';
import type { ChatService, ChatOutcome } from '../../src/services/chat.service';
import type { PlayerManager } from '../../src/managers/player.manager';
import type { CPlayer } from '../../src/entities/player';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  const written: Buffer[] = [];
  return {
    session: { state, charId: 42 },
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => { destroyed = true; },
    _written: written,
    get _destroyed() { return destroyed; },
  };
}

/** OnChat wire layout (`Neuz/DPClient.cpp:9003` SendChat): `String text` only. */
function chatPayload(text: string): Buffer {
  const w = new PacketWriter();
  w.writeString(text);
  return w.build();
}

function fakePlayerManager(player?: CPlayer): PlayerManager {
  return { get: () => player } as unknown as PlayerManager;
}

function fakeService(outcome: ChatOutcome): ChatService {
  return { chat: () => outcome } as unknown as ChatService;
}

const player = { m_idPlayer: 42, m_szName: 'Bob', m_bAuthority: 0 } as unknown as CPlayer;

describe('ChatHandler', () => {
  it('broadcasts a well-formed chat from an IN_WORLD session', () => {
    const handler = new ChatHandler(fakePlayerManager(player), fakeService({ ok: true, reached: 3 }));
    const sock = mockSocket();
    handler.handleChat(sock as never, new PacketReader(chatPayload('hello')));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 0); // broadcast goes via zone manager, not socket
  });

  it('destroys when the socket is not IN_WORLD', () => {
    const handler = new ChatHandler(fakePlayerManager(player), fakeService({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleChat(sock as never, new PacketReader(chatPayload('hi')));
    assert.equal(sock._destroyed, true);
  });

  it('destroys when the player is not in the manager', () => {
    const handler = new ChatHandler(fakePlayerManager(undefined), fakeService({ ok: true, reached: 0 }));
    const sock = mockSocket();
    handler.handleChat(sock as never, new PacketReader(chatPayload('hi')));
    assert.equal(sock._destroyed, true);
  });

  it('drops over-cap text without destroying', () => {
    const handler = new ChatHandler(fakePlayerManager(player), fakeService({ ok: true, reached: 0 }));
    const sock = mockSocket();
    handler.handleChat(sock as never, new PacketReader(chatPayload('x'.repeat(2000))));
    assert.equal(sock._destroyed, false);
  });

  it('drops silently on unknown command', () => {
    const handler = new ChatHandler(fakePlayerManager(player), fakeService({ ok: false, reason: 'command_unknown' }));
    const sock = mockSocket();
    handler.handleChat(sock as never, new PacketReader(chatPayload('/foo')));
    assert.equal(sock._destroyed, false);
  });
});
