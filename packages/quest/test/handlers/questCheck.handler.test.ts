import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { framePacket } from '@flyff/core/net/PacketBuffer';
import { SessionState } from '@flyff/core/constants/sessionState';
import { QuestCheckHandler } from '../../src/handlers/questCheck.handler';
import type { QuestService } from '../../src/services/quest.service';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

function mockSocket() {
  const written: Buffer[] = [];
  return {
    session: { state: SessionState.IN_WORLD, charId: 42 },
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => {},
    _written: written,
  };
}
const payload = (questId: number, bCheck: number) => {
  const w = new PacketWriter();
  w.writeLong(questId);
  w.writeLong(bCheck);
  return w.build();
};
const player = { m_idPlayer: 42 } as unknown as CPlayer;
const fakePm = (p: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;

describe('QuestCheckHandler', () => {
  it('toggles the quest on (bCheck=1) and writes the QUEST_CHECKED frame', async () => {
    let got: { id: number; check: boolean } | null = null;
    const frame = Buffer.from([9, 9]);
    const svc = {
      setChecked: async (_p: CPlayer, id: number, check: boolean) => { got = { id, check }; return frame; },
    } as unknown as QuestService;
    const sock = mockSocket();
    await new QuestCheckHandler(fakePm(player), svc).handleQuestCheck(sock as never, new PacketReader(payload(7, 1)));
    assert.deepEqual(got, { id: 7, check: true });
    assert.deepEqual(sock._written, [framePacket(frame)]);
  });

  it('passes bCheck=0 as check=false', async () => {
    let check = true;
    const svc = {
      setChecked: async (_p: CPlayer, _id: number, c: boolean) => { check = c; return Buffer.alloc(0); },
    } as unknown as QuestService;
    await new QuestCheckHandler(fakePm(player), svc).handleQuestCheck(mockSocket() as never, new PacketReader(payload(7, 0)));
    assert.equal(check, false);
  });
});
