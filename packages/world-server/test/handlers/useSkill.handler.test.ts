import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { UseSkillHandler } from '../../src/handlers/useSkill.handler.js';
import type { SkillService, SkillCastOutcome } from '../../src/services/skill.service.js';
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

/** USESKILL body: WORD wType | WORD wId | DWORD objid | int nUseType | BOOL bControl(4B). */
const payload = (wId: number, objid: number, nUseType: number): Buffer => {
  const w = new PacketWriter();
  w.writeWord(0);            // wType (always 0)
  w.writeWord(wId);          // slot
  w.writeDword(objid);
  w.writeLong(nUseType);
  w.writeLong(0);            // bControl
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('UseSkillHandler', () => {
  it('parses the body and delegates the slot + target to SkillService.cast', () => {
    let got: { wId: number; objid: number; useType: number } | null = null;
    const svc = {
      cast: (_p: CPlayer, f: { wId: number; objid: number; useType: number }) => {
        got = f;
        return { ok: true, hit: true, damage: 5, killed: false } satisfies SkillCastOutcome;
      },
    } as unknown as SkillService;
    const handler = new UseSkillHandler(fakePm(player), svc);
    handler.handleUseSkill(mockSocket() as never, new PacketReader(payload(2, 0x40000005, 0)));
    assert.deepEqual(got, { wId: 2, objid: 0x40000005, useType: 0 });
  });

  it('destroys when not IN_WORLD', () => {
    const svc = { cast: () => ({ ok: true } as SkillCastOutcome) } as unknown as SkillService;
    const handler = new UseSkillHandler(fakePm(player), svc);
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleUseSkill(sock as never, new PacketReader(payload(0, 1, 0)));
    assert.equal(sock._destroyed, true);
  });

  it('does not destroy on a rejected cast (service sends CLEAR_USESKILL)', () => {
    const svc = { cast: () => ({ ok: false, reason: 'cooldown' } as SkillCastOutcome) } as unknown as SkillService;
    const handler = new UseSkillHandler(fakePm(player), svc);
    const sock = mockSocket();
    handler.handleUseSkill(sock as never, new PacketReader(payload(0, 1, 0)));
    assert.equal(sock._destroyed, false);
  });
});
