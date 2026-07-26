import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { MAX_SKILL_JOB } from '@flyff/world-core';
import { SessionState } from '@flyff/core/constants/sessionState';
import { DoUseSkillPointHandler } from '../../src/handlers/doUseSkillPoint.handler';
import type { SkillService, LearnOutcome } from '../../src/services/skill.service';
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

/** DOUSESKILLPOINT body: MAX_SKILL_JOBx (DWORD dwSkill, DWORD dwLevel), no count prefix. */
const payload = (slot: number, skillId: number, level: number): Buffer => {
  const w = new PacketWriter();
  for (let i = 0; i < MAX_SKILL_JOB; i++) {
    w.writeDword(i === slot ? skillId : 0xffffffff);
    w.writeDword(i === slot ? level : 0);
  }
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('DoUseSkillPointHandler', () => {
  it('reads MAX_SKILL_JOB (skill,level) pairs and delegates the roster to SkillService.learnSkills', () => {
    let got: Array<{ skillId: number; level: number }> | null = null;
    const svc = {
      learnSkills: (_p: CPlayer, req: Array<{ skillId: number; level: number }>) => {
        got = req;
        return { ok: true, spent: 3, skillPoint: 7 } satisfies LearnOutcome;
      },
    } as unknown as SkillService;
    const handler = new DoUseSkillPointHandler(fakePm(player), svc);
    handler.handleDoUseSkillPoint(mockSocket() as never, new PacketReader(payload(3, 100, 3)));
    assert.equal(got!.length, MAX_SKILL_JOB, `v19 __3RD_LEGEND16 sizes MAX_SKILL_JOB to ${MAX_SKILL_JOB}`);
    assert.deepEqual(got![3], { skillId: 100, level: 3 });
    assert.equal(got![0]!.skillId, 0xffffffff, 'empty slots carry NULL_ID');
  });

  it('destroys when not IN_WORLD', () => {
    const svc = { learnSkills: () => ({ ok: true, spent: 0, skillPoint: 0 } as LearnOutcome) } as unknown as SkillService;
    const handler = new DoUseSkillPointHandler(fakePm(player), svc);
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleDoUseSkillPoint(sock as never, new PacketReader(payload(0, 1, 1)));
    assert.equal(sock._destroyed, true);
  });
});
