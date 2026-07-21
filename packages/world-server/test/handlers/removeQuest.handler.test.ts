import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { RemoveQuestHandler } from '../../src/handlers/removeQuest.handler.js';
import type { QuestService } from '../../src/services/quest.service.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { CPlayer } from '../../src/entities/player.js';

function mockSocket(state = SessionState.IN_WORLD) {
  const written: Buffer[] = [];
  return {
    session: { state, charId: 42 },
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => {},
    _written: written,
  };
}
const payload = (questId: number) => {
  const w = new PacketWriter();
  w.writeDword(questId);
  return w.build();
};
const player = { m_idPlayer: 42, m_tickScript: 0 } as unknown as CPlayer;
const fakePm = (p: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;

describe('RemoveQuestHandler', () => {
  it('passes questId to the service and writes the returned frame', async () => {
    let got = 0;
    const frame = Buffer.from([1, 2, 3]);
    const svc = {
      cancelQuest: async (_p: CPlayer, id: number) => { got = id; return { ok: true, frames: [frame] }; },
    } as unknown as QuestService;
    const sock = mockSocket();
    await new RemoveQuestHandler(fakePm(player), svc).handleRemoveQuest(sock as never, new PacketReader(payload(7)));
    assert.equal(got, 7);
    assert.deepEqual(sock._written, [frame]);
  });

  it('rate-limits repeat sends within 400ms', async () => {
    let calls = 0;
    const svc = { cancelQuest: async () => { calls++; return { ok: true, frames: [] }; } } as unknown as QuestService;
    const p = { m_idPlayer: 42, m_tickScript: Date.now() - 100 } as unknown as CPlayer;
    const sock = mockSocket();
    await new RemoveQuestHandler(fakePm(p), svc).handleRemoveQuest(sock as never, new PacketReader(payload(7)));
    assert.equal(calls, 0); // 100ms < 400ms → dropped
  });

  it('destroys when not IN_WORLD', async () => {
    let destroyed = false;
    const sock = {
      session: { state: SessionState.CONNECTED, charId: 42 },
      write: () => true,
      destroy: () => { destroyed = true; },
    };
    const svc = { cancelQuest: async () => ({ ok: true, frames: [] }) } as unknown as QuestService;
    await new RemoveQuestHandler(fakePm(player), svc).handleRemoveQuest(sock as never, new PacketReader(payload(7)));
    assert.equal(destroyed, true);
  });
});
