/**
 * NpcBuffService tests -- buff-pang packet gate + apply orchestration.
 *
 * @module test/services/npcBuff.service
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NpcBuffService } from '../../src/services/npcBuff.service';
import type { NpcBuffDeps } from '../../src/services/npcBuff.service';
import { MMI_NPC_BUFF } from '@flyff/resources';
import type { CPlayer, CMover, Vec3 } from '@flyff/entities';
import type { CharacterIncIndex, NpcBuffSkillEntry, SkillDefinition, SkillIndex } from '@flyff/resources';
import type { SkillService } from '@flyff/skills';

type Outcome = 'applied' | 'refreshed' | 'replaced' | 'ignored' | 'conflict';

function makePlayer(level: number, pos: Vec3): CPlayer {
  return {
    m_idPlayer: 42, m_nLevel: level, m_nZoneId: 1, m_vPos: pos,
  } as unknown as CPlayer;
}

function makeNpc(pos: Vec3, hasBuffMenu: boolean): CMover {
  return {
    m_vPos: pos,
    m_nZoneId: 1,
    m_abMoverMenu: hasBuffMenu ? [MMI_NPC_BUFF] : [],
  } as unknown as CMover;
}

/** buffSkills list resolved against this fake skills index. */
function makeBuffSkillEntry(skillId: number, level: number, min: number, max: number): NpcBuffSkillEntry {
  return { skillId, level, minPlayerLevel: min, maxPlayerLevel: max, durationMs: 3_600_000 };
}

function makeSkillIndex(ids: number[]): SkillIndex {
  const skills = new Map<number, SkillDefinition>();
  for (const id of ids) {
    skills.set(id, {
      id, name: `s${id}`, name_id: `IDS_${id}`, tier: 1, job: 3, discipline: 0,
      reqLevel: 0, prereqs: [], resourceType: 1, maxLevel: 20,
      levels: [
        { level: 1, skillTime: 60_000, destParams: [2], adjParamVals: [10] },
        { level: 2, skillTime: 60_000, destParams: [2], adjParamVals: [10] },
        { level: 7, skillTime: 60_000, destParams: [2], adjParamVals: [10] },
      ],
    });
  }
  return { skills } as unknown as SkillIndex;
}

interface FakeOpts {
  npcs?: CMover[];
  outcomes?: Map<number, Outcome>; // skillId -> outcome
  blockKey?: string;
}

function makeService(opts: FakeOpts): { svc: NpcBuffService; calls: number[] } {
  const blockKey = opts.blockKey ?? 'MaFl_Helper';
  const entries: NpcBuffSkillEntry[] = [
    makeBuffSkillEntry(317, 2, 1, 30),
    makeBuffSkillEntry(318, 2, 1, 30),
    makeBuffSkillEntry(123, 7, 5, 99),
  ];
  const characterInc: CharacterIncIndex = {
    byKey: new Map([[blockKey, { key: blockKey, buffSkills: entries }]]),
    byStem: new Map(),
  } as unknown as CharacterIncIndex;
  const calls: number[] = [];
  const outcomes = opts.outcomes ?? new Map<number, Outcome>();
  const skillService = {
    applyNpcBuff: (_p: CPlayer, skill: SkillDefinition, _l: unknown, _d: number, _n: number): Outcome =>
      outcomes.get(skill.id) ?? 'applied',
  } as unknown as SkillService;
  const deps: NpcBuffDeps = {
    spawnManager: { inZone: () => opts.npcs ?? [] },
    characterInc,
    skills: makeSkillIndex([317, 318, 123]),
    skillService,
  };
  // Wrap applyNpcBuff to record call order.
  const realApply = deps.skillService.applyNpcBuff.bind(deps.skillService);
  deps.skillService.applyNpcBuff = ((p: CPlayer, s: SkillDefinition, l: unknown, d: number, n: number) => {
    calls.push(s.id);
    return realApply(p, s, l, d, n);
  }) as typeof deps.skillService.applyNpcBuff;
  return { svc: new NpcBuffService(deps), calls };
}

describe('NpcBuffService', () => {
  it('applies every in-range entry; skips out-of-range', () => {
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    const npc = makeNpc({ x: 0, y: 0, z: 0 }, true);
    const { svc, calls } = makeService({ npcs: [npc] });

    const out = svc.buff(p, 'MaFl_Helper', 1000);

    assert.equal(out.ok, true);
    // Entry 3 (skill 123, range 5..99) is in-range at level 15; all three apply.
    assert.deepEqual(calls, [317, 318, 123]);
    assert.equal(out.ok === true && out.applied, 3);
    assert.equal(out.ok === true && out.skipped, 0);
  });

  it('skips entries outside the player level range', () => {
    // Player level 3: entry 3 (skill 123, min 5) is out of range.
    const p = makePlayer(3, { x: 0, y: 0, z: 0 });
    const npc = makeNpc({ x: 0, y: 0, z: 0 }, true);
    const { svc, calls } = makeService({ npcs: [npc] });

    const out = svc.buff(p, 'MaFl_Helper', 1000);

    assert.deepEqual(calls, [317, 318], 'skill 123 skipped (level 3 < min 5)');
    assert.equal(out.ok === true && out.applied, 2);
    assert.equal(out.ok === true && out.skipped, 1);
  });

  it('tallies conflicts + refreshes', () => {
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    const npc = makeNpc({ x: 0, y: 0, z: 0 }, true);
    const { svc } = makeService({
      npcs: [npc],
      outcomes: new Map([[317, 'conflict'], [318, 'refreshed'], [123, 'replaced']]),
    });

    const out = svc.buff(p, 'MaFl_Helper', 1000);

    assert.equal(out.ok === true && out.conflicts, 1);
    assert.equal(out.ok === true && out.refreshed, 1);
    assert.equal(out.ok === true && out.replaced, 1);
  });

  it('rejects with no_nearby_buff_npc when no buff NPC is in range', () => {
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    // NPC with MMI_NPC_BUFF but 100 units away (100^2 = 10000 > 1024).
    const far = makeNpc({ x: 100, y: 0, z: 0 }, true);
    const { svc } = makeService({ npcs: [far] });

    const out = svc.buff(p, 'MaFl_Helper', 1000);

    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.reason, 'no_nearby_buff_npc');
  });

  it('rejects with no_nearby_buff_npc when no NPC has MMI_NPC_BUFF', () => {
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    const tradeOnly = makeNpc({ x: 0, y: 0, z: 0 }, false);
    const { svc } = makeService({ npcs: [tradeOnly] });

    const out = svc.buff(p, 'MaFl_Helper', 1000);

    assert.equal(out.ok === false && out.reason, 'no_nearby_buff_npc');
  });

  it('accepts at the 1024 squared-distance boundary, rejects at 1025', () => {
    // sqrt(1024) = 32 on one axis.
    const atBoundary = makeNpc({ x: 32, y: 0, z: 0 }, true);
    const p1 = makePlayer(15, { x: 0, y: 0, z: 0 });
    const svc1 = makeService({ npcs: [atBoundary] });
    assert.equal(svc1.svc.buff(p1, 'MaFl_Helper', 1000).ok, true);

    const overBoundary = makeNpc({ x: 33, y: 0, z: 0 }, true); // 33^2 = 1089 > 1024
    const p2 = makePlayer(15, { x: 0, y: 0, z: 0 });
    const svc2 = makeService({ npcs: [overBoundary] });
    assert.equal(svc2.svc.buff(p2, 'MaFl_Helper', 1000).ok, false);
  });

  it('flattens Y: a pang on a different elevation counts as near (XZ-only)', () => {
    // Ground distance 5 (25 sq) but huge Y offset -- full 3D would be 10025 > 1024.
    const elevated = makeNpc({ x: 0, y: 100, z: 5 }, true);
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    const svc = makeService({ npcs: [elevated] });
    assert.equal(svc.svc.buff(p, 'MaFl_Helper', 1000).ok, true);
  });

  it('rejects with unknown_npc when the key is not a character.inc block', () => {
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    const { svc } = makeService({ npcs: [makeNpc({ x: 0, y: 0, z: 0 }, true)] });

    const out = svc.buff(p, 'MaFl_DoesNotExist', 1000);

    assert.equal(out.ok === false && out.reason, 'unknown_npc');
  });

  it('rejects with not_buff_npc when the block has no SetBuffSkill', () => {
    const p = makePlayer(15, { x: 0, y: 0, z: 0 });
    const { svc } = makeService({ npcs: [makeNpc({ x: 0, y: 0, z: 0 }, true)], blockKey: 'MaFl_Empty' });
    // Override the block to have empty buffSkills.
    (svc as unknown as { deps: NpcBuffDeps }).deps.characterInc.byKey.set('MaFl_Empty', {
      key: 'MaFl_Empty', buffSkills: [],
    });
    const out = svc.buff(p, 'MaFl_Empty', 1000);

    assert.equal(out.ok === false && out.reason, 'not_buff_npc');
  });
});
