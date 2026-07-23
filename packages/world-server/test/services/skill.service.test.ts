import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { SkillService } from '../../src/services/skill.service';
import { NULL_ID } from '@flyff/world-core';
import type { CharacterRow } from '@flyff/database';
import type { SkillIndex, SkillDefinition } from '@flyff/resources';

/** Minimal CharacterRow for CPlayer.fromRow (mirrors player.test.ts). */
function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'TestHero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0, face_style: 3, skin_color: 1,
    level: 15, exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSocket() {
  const written: Buffer[] = [];
  return { write: (b: Buffer) => { written.push(b); return true; }, _written: written };
}

/** A fake melee damage skill (EXT_MELEEATK=17, KT_SKILL=FP) with one level. */
function meleeSkill(over: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 100, name: 'Clean Hit', name_id: 'IDS_CLEAN', tier: 0, job: 0,
    discipline: 0, reqLevel: 0, prereqs: [], resourceType: 2, maxLevel: 5,
    exeTarget: 17, baseCooldown: 1000,
    levels: [{ level: 1, reqMp: 0, reqFp: 5, cooldown: 500, castingTime: 0, abilityMin: 10, abilityMax: 20 }],
    ...over,
  };
}

/** A fake Heal (RT_HEAL, KT_MAGIC=MP). Matches assist.yml id 44 shape. */
function healSkill(over: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 44, name: 'Heal', name_id: 'IDS_HEAL', tier: 1, job: 3,
    discipline: 11, reqLevel: 0, prereqs: [], resourceType: 1, maxLevel: 20,
    referStats: [3, 0], referTargets: [3, 0], referValues: [30, 0],
    // reqFp:83 is in the data but resourceType=1 (MP) -- NOT consumed.
    levels: [{ level: 1, reqMp: 17, reqFp: 83, adjParamVals: [100, 150], castingTime: 150, cooldown: 0 }],
    ...over,
  };
}

interface MockDeps {
  service: SkillService;
  sent: Buffer[];
  broadcasts: Buffer[];
  calls: { resolve: number };
  spawnGet: (id: number) => { m_bDead: boolean } | undefined;
  setSpawn: (fn: (id: number) => { m_bDead: boolean } | undefined) => void;
  resolveResult: { ok: true; hit: boolean; damage: number; killed: boolean };
}

function makeService(
  skills: Map<number, SkillDefinition>,
  player: CPlayer,
  extraPlayers: CPlayer[] = [],
): MockDeps {
  const sent: Buffer[] = [];
  const broadcasts: Buffer[] = [];
  const calls = { resolve: 0 };
  const playerMap = new Map<number, CPlayer>();
  for (const p of extraPlayers) playerMap.set(p.m_idPlayer, p);
  const state = {
    spawnGet: ((_id: number) => ({ m_bDead: false })) as (id: number) => ({ m_bDead: boolean } | undefined),
    resolveResult: { ok: true, hit: true, damage: 42, killed: false } as const,
  };
  const deps = {
    skills: { skills } as unknown as SkillIndex,
    spawnManager: { get: (id: number) => state.spawnGet(id) },
    zoneManager: { broadcastAround: () => { broadcasts.push(Buffer.alloc(0)); return 1; } },
    playerManager: {
      sendTo: (_p: unknown, b: Buffer) => { sent.push(b); },
      get: (id: number) => playerMap.get(id),
    },
    combatService: { resolveSkill: () => { calls.resolve++; return state.resolveResult; } },
    skillRepo: { saveAll: async () => {} },
    charRepo: { updateSkillPoints: async () => {} },
  };
  const service = new SkillService(deps);
  return {
    service, sent, broadcasts, calls,
    spawnGet: (id) => state.spawnGet(id),
    setSpawn: (fn) => { state.spawnGet = fn; },
    resolveResult: state.resolveResult as MockDeps['resolveResult'],
  };
}

describe('SkillService.cast', () => {
  it('spends FP (resourceType=2), sets cooldown, broadcasts USESKILL, runs damage', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 10;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const skills = new Map([[100, meleeSkill()]]);
    const m = makeService(skills, p);

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });

    assert.equal(out.ok, true);
    assert.equal(p.m_nFp, 5, 'FP spent (10 - 5)');
    assert.equal(p.m_nMp, 50, 'MP untouched on FP skill');
    assert.equal(m.calls.resolve, 1, 'damage pipeline ran once');
    assert.equal(m.broadcasts.length, 1, 'USESKILL broadcast to vicinity');
    assert.equal(m.sent.length, 1, 'SETPOINTPARAM DST_FP sent to self');
    assert.ok(p.m_tmReUseDelay[0]! > 0, 'cooldown set on slot 0');
  });

  it('rejects an empty slot with CLEAR_USESKILL and no damage', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.reason, 'not_learned');
    assert.equal(m.calls.resolve, 0);
    assert.equal(m.sent.length, 1, 'CLEAR_USESKILL sent');
    assert.equal(p.m_nMp, 50, 'no MP spent on reject');
  });

  it('rejects a dead caster', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    p.m_bDead = true;
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'dead');
    assert.equal(m.calls.resolve, 0);
  });

  it('rejects while on cooldown', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    p.m_tmReUseDelay[0] = Date.now() + 10_000;
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'cooldown');
    assert.equal(m.calls.resolve, 0);
  });

  it('rejects when FP is insufficient', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 2;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'no_fp');
    assert.equal(m.calls.resolve, 0);
    assert.equal(p.m_nFp, 2, 'FP untouched on reject');
  });

  it('rejects a missing target', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    m.setSpawn(() => undefined);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'invalid_target');
    assert.equal(m.calls.resolve, 0);
    assert.equal(p.m_nMp, 50, 'no MP spent before target check');
  });

  it('rejects a dead target', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    m.setSpawn(() => ({ m_bDead: true }));
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'target_dead');
  });

  it('rejects a non-damage skill (heal/buff) as unsupported', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const heal = meleeSkill({ exeTarget: 1 }); // EXT_SELFCHGPARAMET
    const m = makeService(new Map([[100, heal]]), p);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'unsupported');
    assert.equal(m.calls.resolve, 0);
  });

  it('accepts a magic damage skill (EXT_MAGICATKSHOT=14)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const magic = meleeSkill({ exeTarget: 14, levels: [{ level: 1, reqMp: 8, reqFp: 0, cooldown: 0, castingTime: 0 }] });
    const m = makeService(new Map([[100, magic]]), p);
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    assert.equal(out.ok, true);
    assert.equal(m.calls.resolve, 1);
  });
});

describe('SkillService.cast (heal)', () => {
  // healSkill L1, caster INT=15: 100 + floor(30/10)*15 + 1*floor(15/50) = 145.
  const HEAL_L1_INT15 = 145;

  it('resource gate: MP skill with nonzero reqFp in data only checks MP', () => {
    // healSkill has resourceType=1 (MP), reqMp:17, reqFp:83. m_nFp defaults 0.
    // Before the resourceType fix this wrongly failed with no_fp.
    const p = CPlayer.fromRow(makeRow({ mp: 50, max_mp: 100, hp: 100, max_hp: 1000 }), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const m = makeService(new Map([[44, healSkill()]]), p);
    const out = m.service.cast(p, { wId: 0, objid: p.m_idPlayer, useType: 0 });
    assert.equal(out.ok, true, 'MP-skill cast not blocked by reqFp in data');
    assert.equal(p.m_nFp, 0, 'FP untouched on MP skill');
  });

  it('restores HP on self by the RT_HEAL formula and spends only MP', () => {
    const p = CPlayer.fromRow(makeRow({ hp: 10, max_hp: 1000, mp: 50, max_mp: 100 }), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const m = makeService(new Map([[44, healSkill()]]), p);
    const out = m.service.cast(p, { wId: 0, objid: p.m_idPlayer, useType: 0 });
    assert.equal(out.ok, true);
    assert.equal(p.m_nHp, 10 + HEAL_L1_INT15, 'HP restored by heal formula');
    assert.equal(p.m_nMp, 33, 'MP spent (50 - 17)');
    assert.equal(m.calls.resolve, 0, 'heal does not run the damage pipeline');
    assert.ok(m.broadcasts.length >= 1, 'USESKILL broadcast');
  });

  it('heals another live player target and notifies both', () => {
    const caster = CPlayer.fromRow(makeRow({ id: 42, mp: 50, max_mp: 100 }), makeSocket());
    const target = CPlayer.fromRow(makeRow({ id: 99, hp: 10, max_hp: 1000 }), makeSocket());
    caster.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const m = makeService(new Map([[44, healSkill()]]), caster, [target]);
    const out = m.service.cast(caster, { wId: 0, objid: 99, useType: 0 });
    assert.equal(out.ok, true);
    assert.equal(target.m_nHp, 10 + HEAL_L1_INT15, 'target healed');
    assert.equal(caster.m_nMp, 33, 'caster spent MP');
  });

  it('rejects a dead heal target without spending MP', () => {
    const caster = CPlayer.fromRow(makeRow({ id: 42, mp: 50, max_mp: 100 }), makeSocket());
    const target = CPlayer.fromRow(makeRow({ id: 99, hp: 0, max_hp: 100 }), makeSocket());
    target.m_bDead = true;
    caster.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const m = makeService(new Map([[44, healSkill()]]), caster, [target]);
    const out = m.service.cast(caster, { wId: 0, objid: 99, useType: 0 });
    assert.equal(out.ok === false && out.reason, 'target_dead');
    assert.equal(caster.m_nMp, 50, 'no MP spent before target check');
  });

  it('clamps heal to maxHp', () => {
    const p = CPlayer.fromRow(makeRow({ hp: 95, max_hp: 100, mp: 50, max_mp: 100 }), makeSocket());
    p.m_nMaxHp = 100; // formula-derived in fromRow; pin to the test's ceiling
    p.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const m = makeService(new Map([[44, healSkill()]]), p);
    m.service.cast(p, { wId: 0, objid: p.m_idPlayer, useType: 0 });
    assert.equal(p.m_nHp, 100, 'clamped to maxHp');
  });
});

describe('SkillService.learnSkills', () => {
  it('spends SP at tier cost, applies the roster, confirms + persists', async () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 10;
    const skills = new Map([[100, meleeSkill()]]);
    const m = makeService(skills, p);

    // 45-slot request: slot 0 -> Clean Hit L3 (vagrant tier 0 = 1 SP/level => 3).
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 3 };
    const out = m.service.learnSkills(p, req);

    assert.equal(out.ok, true);
    assert.equal(out.ok === true && out.spent, 3);
    assert.deepEqual(p.m_aJobSkill[0], { skillId: 100, level: 3 });
    assert.equal(p.m_nSkillPoint, 7);
    assert.ok(p._dirty.has('m_aJobSkill'));
    assert.ok(p._dirty.has('m_nSkillPoint'));
    // confirm snapshot sent to self (last buffered write).
    assert.ok(m.sent.length >= 1);
  });

  it('rejects a level decrease', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 10;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 5 }]);
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 3 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'decrease');
    assert.equal(p.m_nSkillPoint, 10, 'no SP spent on reject');
  });

  it('rejects above maxLevel', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 100;
    const m = makeService(new Map([[100, meleeSkill({ maxLevel: 5 })]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 99 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'over_max');
  });

  it('rejects insufficient SP', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 1;
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 3 }; // costs 3
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'insufficient_sp');
  });

  it('rejects below the skill reqLevel', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket()); // level 15
    p.m_nSkillPoint = 50;
    const m = makeService(new Map([[100, meleeSkill({ reqLevel: 50 })]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 1 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'low_level');
  });

  it('rejects when a prerequisite skill is missing', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 50;
    const sk = meleeSkill({ prereqs: [{ skill: 50, level: 1 }] });
    const m = makeService(new Map([[100, sk]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 1 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'prereq');
  });

  it('rejects reassigning an occupied slot to a different skill id', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 50;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const m = makeService(new Map([[100, meleeSkill()], [200, meleeSkill({ id: 200 })]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 200, level: 1 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'slot_occupied');
  });

  it('charges the expert tier cost (2 SP/level)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 20;
    const sk = meleeSkill({ tier: 1 }); // EXPERT
    const m = makeService(new Map([[100, sk]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 4 }; // 4 * 2 = 8
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok, true);
    assert.equal(out.ok === true && out.spent, 8);
    assert.equal(p.m_nSkillPoint, 12);
  });
});
