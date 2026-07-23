import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { QuestHelperHandler } from '../../src/handlers/questHelper.handler';
import type { SpawnManager } from '../../src/managers/spawn.manager';
import type { PlayerManager } from '../../src/managers/player.manager';
import type { CPlayer } from '../../src/entities/player';

function mockSocket() {
  const written: Buffer[] = [];
  return {
    session: { state: SessionState.IN_WORLD, charId: 42 },
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => {},
    _written: written,
  };
}
/** DWORD-length-prefixed string payload. */
const payload = (key: string) => {
  const w = new PacketWriter();
  w.writeString(key);
  return w.build();
};
const player = { m_idPlayer: 42 } as unknown as CPlayer;
const fakePm = (p: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;

describe('QuestHelperHandler', () => {
  it('writes the NPCPOS frame when the NPC is spawned', () => {
    let key = '';
    const npc = { m_vPos: { x: 1, y: 2, z: 3 } } as unknown as CPlayer;
    const sm = { findByCharacterKey: (k: string) => { key = k; return npc; } } as unknown as SpawnManager;
    const sock = mockSocket();
    new QuestHelperHandler(fakePm(player), sm).handleQuestHelper(sock as never, new PacketReader(payload('MAFA_ROSTAF')));
    assert.equal(key, 'MAFA_ROSTAF');
    assert.equal(sock._written.length, 1);
  });

  it('drops silently when the NPC is not spawned', () => {
    const sm = { findByCharacterKey: () => undefined } as unknown as SpawnManager;
    const sock = mockSocket();
    new QuestHelperHandler(fakePm(player), sm).handleQuestHelper(sock as never, new PacketReader(payload('NOPE')));
    assert.equal(sock._written.length, 0);
  });
});
