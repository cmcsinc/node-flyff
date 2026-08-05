import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, CMover, DST, CHRSTATE_BITS, AR, RANGE_HITBOX_SLACK } from '@flyff/entities';
import { SkillService } from '../../src/services/skill.service';
import { NULL_ID, SHORTCUT, SNAPSHOTTYPE_ENDSKILLQUEUE } from '@flyff/world-core';
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

interface JournalCall { charId: number; type: string; payload: unknown; }

interface MockDeps {
  service: SkillService;
  sent: Buffer[];
  broadcasts: Buffer[];
  calls: { resolve: number };
  journalCalls: JournalCall[];
  spawnGet: (id: number) => { m_bDead: boolean } | undefined;
  setSpawn: (fn: (id: number) => { m_bDead: boolean } | undefined) => void;
  resolveResult: { ok: true; hit: boolean; damage: number; killed: boolean };
}

function makeService(
  skills: Map<number, SkillDefinition>,
  player: CPlayer,
  extraPlayers: CPlayer[] = [],
  mover?: CMover,
): MockDeps {
  const sent: Buffer[] = [];
  const broadcasts: Buffer[] = [];
  const calls = { resolve: 0 };
  const journalCalls: JournalCall[] = [];
  const playerMap = new Map<number, CPlayer>();
  playerMap.set(player.m_idPlayer, player);
  for (const p of extraPlayers) playerMap.set(p.m_idPlayer, p);
  const state = {
    spawnGet: ((_id: number) => (mover ?? { m_bDead: false }) as CMover | { m_bDead: boolean }) as (id: number) => (CMover | { m_bDead: boolean } | undefined),
    resolveResult: { ok: true, hit: true, damage: 42, killed: false } as const,
  };
  const deps = {
    skills: { skills } as unknown as SkillIndex,
    spawnManager: { get: (id: number) => state.spawnGet(id) },
    zoneManager: {
      broadcastAround: (_pos: unknown, _zone: unknown, _r: unknown, buf: Buffer) => {
        broadcasts.push(buf);
        return 1;
      },
    },
    playerManager: {
      sendTo: (_p: unknown, b: Buffer) => { sent.push(b); },
      get: (id: number) => playerMap.get(id),
    },
    combatService: { resolveSkill: () => { calls.resolve++; return state.resolveResult; } },
    skillRepo: { saveAll: async () => {} },
    charRepo: { updateSkillPoints: async () => {} },
    journal: { append: (e: JournalCall) => { journalCalls.push(e); return journalCalls.length; } },
  };
  const service = new SkillService(deps);
  return {
    service, sent, broadcasts, calls, journalCalls,
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

  it('wires nCastingTime as 0 for KT_MAGIC and 1 for KT_SKILL, never the data value', () => {
    // __NEW_TASKBAR_V19 (MoverSkill.cpp:246-266) hardcodes these; the field is in
    // TICKS (client scales *66.66ms). Sending Heal's raw castingTime:150 froze
    // the caster ~10 s in OBJSTA_ATK_CASTING2.
    const readCastingTime = (buf: Buffer): number => buf.readUInt32LE(buf.length - 4);

    const mage = CPlayer.fromRow(makeRow({ mp: 50, max_mp: 100, hp: 10, max_hp: 1000 }), makeSocket());
    mage.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const mMagic = makeService(new Map([[44, healSkill()]]), mage);
    assert.equal(mMagic.service.cast(mage, { wId: 0, objid: mage.m_idPlayer, useType: 0 }).ok, true);
    assert.equal(readCastingTime(mMagic.broadcasts[0]!), 0, 'KT_MAGIC casting time is 0');

    // Same skill re-tagged KT_SKILL (resourceType 2) -> 1, despite castingTime:150.
    const fp = CPlayer.fromRow(makeRow({ hp: 10, max_hp: 1000 }), makeSocket());
    fp.m_nFp = 100;
    fp.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const mSkill = makeService(new Map([[44, healSkill({ resourceType: 2, levels: [{ level: 1, reqMp: 0, reqFp: 5, adjParamVals: [100, 150], castingTime: 150, cooldown: 0 }] })]]), fp);
    assert.equal(mSkill.service.cast(fp, { wId: 0, objid: fp.m_idPlayer, useType: 0 }).ok, true);
    assert.equal(readCastingTime(mSkill.broadcasts[0]!), 1, 'KT_SKILL casting time is 1');
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

describe('SkillService.cast (buff)', () => {
  /** RT_TIME self-buff: +20 STA for 300s (Assist-style Cannonball). */
  function buffSkill(over: Partial<SkillDefinition> = {}): SkillDefinition {
    return {
      id: 150, name: 'Cannonball', name_id: 'IDS_CANNON', tier: 1, job: 3,
      discipline: 0, reqLevel: 0, prereqs: [], resourceType: 1, maxLevel: 20,
      referTargets: [2, 0], referStats: [4, 0], referValues: [0, 0],
      levels: [{
        level: 1, reqMp: 20, reqFp: 0, skillTime: 300_000,
        destParams: [4, 0], adjParamVals: [20, 0],
      }],
      ...over,
    };
  }

  it('attaches a timed DST buff to the caster + broadcasts SETSKILLSTATE', () => {
    const p = CPlayer.fromRow(makeRow({ mp: 50, max_mp: 100 }), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 150, level: 1 }]);
    const m = makeService(new Map([[150, buffSkill()]]), p);

    const out = m.service.cast(p, { wId: 0, objid: p.m_idPlayer, useType: 0 });

    assert.equal(out.ok, true);
    assert.equal(p.m_nMp, 30, 'MP spent (50 - 20)');
    assert.equal(p.m_buffs.has(150), true, 'buff active on caster');
    assert.equal(p.m_params.get(DST.STA, 0), 20, '+STA applied to the DST pool');
    // USESKILL (cast anim) + SETSKILLSTATE (buff icon) + SETDESTPARAM (STA delta).
    assert.equal(m.broadcasts.length, 3);
  });

  it('refreshes duration on re-cast (same level), no double-apply', () => {
    const p = CPlayer.fromRow(makeRow({ mp: 100, max_mp: 200 }), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 150, level: 1 }]);
    const m = makeService(new Map([[150, buffSkill()]]), p);

    m.service.cast(p, { wId: 0, objid: p.m_idPlayer, useType: 0 });
    m.service.cast(p, { wId: 0, objid: p.m_idPlayer, useType: 0 });

    assert.equal(p.m_buffs.size, 1, 'one buff slot, not two');
    assert.equal(p.m_params.get(DST.STA, 0), 20, 'STA not double-applied');
  });
});

describe('SkillService.cast (debuff on monster)', () => {
  /** RT_TIME debuff: stun (CHRSTATE STUN bit) for 5s, targets a mover. */
  function stunSkill(over: Partial<SkillDefinition> = {}): SkillDefinition {
    return {
      id: 160, name: 'Stun', name_id: 'IDS_STUN', tier: 2, job: 6,
      discipline: 0, reqLevel: 0, prereqs: [], resourceType: 1, maxLevel: 20,
      referTargets: [2, 0], referStats: [0, 0], referValues: [0, 0],
      levels: [{
        level: 1, reqMp: 10, reqFp: 0, skillTime: 5_000,
        // CHRSTATE stun bit (0x0800) as the DST_CHRSTATE adj.
        destParams: [64, 0], adjParamVals: [CHRSTATE_BITS.STUN, 0],
      }],
      ...over,
    };
  }

  it('applies a stun debuff to the targeted monster', () => {
    const p = CPlayer.fromRow(makeRow({ mp: 50, max_mp: 100 }), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 160, level: 1 }]);
    const mob = CMover.spawn(999, { modelIndex: 0, key: '', name: 'Mob', level: 5, hp: 100 }, { x: 0, y: 0, z: 0 }, 1);
    const m = makeService(new Map([[160, stunSkill()]]), p, [], mob);

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });

    assert.equal(out.ok, true);
    assert.equal(p.m_nMp, 40, 'MP spent (50 - 10)');
    // Debuff landed on the MOVER's pool, not the player's.
    assert.equal(mob.m_buffs.has(160), true);
    assert.equal(mob.isStunned(), true, 'monster is stunned');
    assert.equal(p.m_buffs.has(160), false, 'caster unaffected');
  });

  it('rejects a dead monster target', () => {
    const p = CPlayer.fromRow(makeRow({ mp: 50, max_mp: 100 }), makeSocket());
    p.hydrateSkills([{ slot: 0, skillId: 160, level: 1 }]);
    const mob = CMover.spawn(999, { modelIndex: 0, key: '', name: 'Mob', level: 5, hp: 100 }, { x: 0, y: 0, z: 0 }, 1);
    mob.m_bDead = true;
    const m = makeService(new Map([[160, stunSkill()]]), p, [], mob);

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });

    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.reason, 'target_dead');
    assert.equal(p.m_nMp, 50, 'no MP spent on reject');
  });
});

describe('SkillService.cast cast-range gate', () => {
  /** AR_LONG (=3 m) melee skill; reach = 3 + RANGE_HITBOX_SLACK. */
  function shortSkill(over: Partial<SkillDefinition> = {}): SkillDefinition {
    return meleeSkill({ attackRange: AR.LONG, ...over });
  }

  function mobAt(x: number): CMover {
    return CMover.spawn(
      999, { modelIndex: 0, key: '', name: 'Mob', level: 5, hp: 100 },
      { x, y: 0, z: 0 }, 1,
    );
  }

  it('accepts a target inside AR_LONG + hitbox slack', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const mob = mobAt(3 + RANGE_HITBOX_SLACK - 0.5);
    const m = makeService(new Map([[100, shortSkill()]]), p, [], mob);

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });

    assert.equal(out.ok, true);
    assert.equal(m.calls.resolve, 1);
  });

  it('rejects a target beyond AR_LONG + hitbox slack, spending nothing', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    const mob = mobAt(3 + RANGE_HITBOX_SLACK + 0.5);
    const m = makeService(new Map([[100, shortSkill()]]), p, [], mob);

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });

    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.reason, 'too_far');
    assert.equal(m.calls.resolve, 0, 'damage pipeline never ran');
    assert.equal(p.m_nFp, 100, 'no FP spent on an out-of-range cast');
    assert.equal(p.m_tmReUseDelay[0] ?? 0, 0, 'no cooldown burned');
    assert.equal(m.broadcasts.length, 0, 'no USESKILL broadcast');
    assert.equal(m.sent.length, 1, 'CLEAR_USESKILL sent to caster');
  });

  it('uses the base AR_* reach, not the per-level AoE skillRange', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    // AR_WAND = 15 m reach, but the level's AoE radius is only 1 m. Reading
    // skillRange here (the old bug) would reject a 12 m cast the client allows.
    const skill = meleeSkill({
      attackRange: AR.WAND,
      levels: [{ level: 1, reqFp: 5, cooldown: 0, castingTime: 0, skillRange: 1 }],
    });
    const m = makeService(new Map([[100, skill]]), p, [], mobAt(12));

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });

    assert.equal(out.ok, true, 'AR_WAND reaches 15 m regardless of the 1 m AoE');
  });

  it('extends reach by DST_HAWKEYE_RATE', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    // AR_RANGE 10 m: out of reach at 14 m bare (10 + 2 slack), in reach with
    // Hawkeye +50% (15 + 2 slack).
    const skill = meleeSkill({ attackRange: AR.RANGE });
    const far = 10 + RANGE_HITBOX_SLACK + 2;

    const bare = makeService(new Map([[100, skill]]), p, [], mobAt(far));
    assert.equal(bare.service.cast(p, { wId: 0, objid: 999, useType: 0 }).ok, false);

    p.m_params.setDestParam(DST.HAWKEYE_RATE, 50);
    p.m_tmReUseDelay[0] = 0;
    const buffed = makeService(new Map([[100, skill]]), p, [], mobAt(far));
    assert.equal(buffed.service.cast(p, { wId: 0, objid: 999, useType: 0 }).ok, true);
  });

  it('skips the range gate for a self-target (NULL_ID)', () => {
    const p = CPlayer.fromRow(makeRow({ hp: 50, max_hp: 100 }), makeSocket());
    p.m_nMp = 100;
    p.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    // AR_SHORT (2 m) heal cast on self -- targetPos is null, no distance check.
    const m = makeService(new Map([[44, healSkill({ attackRange: AR.SHORT })]]), p);

    const out = m.service.cast(p, { wId: 0, objid: NULL_ID, useType: 0 });

    assert.equal(out.ok, true);
    assert.ok(p.m_nHp > 50, 'self-heal landed');
  });

  it('rejects a cast on a distant player target', () => {
    const caster = CPlayer.fromRow(makeRow(), makeSocket());
    caster.m_nMp = 100;
    caster.hydrateSkills([{ slot: 0, skillId: 44, level: 1 }]);
    const ally = CPlayer.fromRow(makeRow({ id: 43, hp: 10, max_hp: 100 }), makeSocket());
    ally.m_vPos = { x: 40, y: 0, z: 0 };
    // AR_WAND = 15 m; the ally sits at 40 m.
    const m = makeService(new Map([[44, healSkill({ attackRange: AR.WAND })]]), caster, [ally]);

    const out = m.service.cast(caster, { wId: 0, objid: 43, useType: 0 });

    assert.equal(out.ok === false && out.reason, 'too_far');
    assert.equal(ally.m_nHp, 10, 'no heal applied');
    assert.equal(caster.m_nMp, 100, 'no MP spent');
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
    // WAL SKILL_LEARN journaled BEFORE the fire-and-forget DB persist: absolute
    // roster + SP so replay is idempotent (rule 04-persistence).
    assert.equal(m.journalCalls.length, 1);
    const j = m.journalCalls[0]!;
    assert.equal(j.charId, p.m_idPlayer);
    assert.equal(j.type, 'SKILL_LEARN');
    const jp = j.payload as { roster: Array<{ slot: number; skillId: number; level: number }>; skillPoint: number; skillLevel: number };
    assert.equal(jp.skillPoint, 7);
    assert.deepEqual(jp.roster[0], { slot: 0, skillId: 100, level: 3 });
  });

  it('does not journal when no SP is spent (empty batch)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 10;
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    // All-empty request -> nothing raised -> totalCost 0 -> no WAL row.
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok, true);
    assert.equal(m.journalCalls.length, 0);
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

  it('rejects a skill whose job is outside the player class lineage (wrong_job)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket()); // class 1 = MERCENARY
    p.m_nSkillPoint = 100;
    // skill job:6 (KNIGHT) -- MERCENARY cannot learn a 2nd-job skill.
    const m = makeService(new Map([[100, meleeSkill({ job: 6 })]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 1 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok === false && out.reason, 'wrong_job');
    assert.equal(p.m_nSkillPoint, 100, 'no SP spent on reject');
  });

  it('accepts an ancestor-class skill (KNIGHT player learns MERCENARY skill)', () => {
    const p = CPlayer.fromRow(makeRow({ class: 6 }), makeSocket()); // KNIGHT
    p.m_nSkillPoint = 10;
    // skill job:1 (MERCENARY) -- KNIGHT descends from MERCENARY => allowed.
    const m = makeService(new Map([[100, meleeSkill({ job: 1 })]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 1 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok, true);
    assert.equal(p.m_nSkillPoint, 9);
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

  it('does not gate on prerequisites (C++ OnDoUseSkillPoint never reads dwReSkill)', () => {
    // `DPSrvr.cpp:3305` checks only no-decrease, dwExpertMax, and SP. The
    // prereq lives client-side in `CMover::CheckSkill` and is skipped there
    // whenever the prereq skill is absent from the roster -- which is the norm,
    // since propSkill.txt's `=` inherit bleeds cross-job dwReSkill1 values into
    // most rows. Enforcing it here rejected nearly every legitimate learn.
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nSkillPoint = 50;
    const sk = meleeSkill({ prereqs: [{ skill: 50, level: 1 }] });
    const m = makeService(new Map([[100, sk]]), p);
    const req = Array.from({ length: 45 }, () => ({ skillId: NULL_ID, level: 0 }));
    req[0] = { skillId: 100, level: 1 };
    const out = m.service.learnSkills(p, req);
    assert.equal(out.ok, true);
    assert.equal(p.m_aJobSkill[0]!.level, 1);
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

/** A non-empty skill queue slot pointing at roster index `slot`. */
function queueSlot(slot: number) {
  return { dwShortcut: SHORTCUT.SKILLFUN, dwId: slot, dwType: 0, dwIndex: slot, dwUserId: 0, dwData: 0 };
}

describe('SkillService action-slot queue progression', () => {
  // The combo is timer-spaced (one cast per QUEUE_ACTION_FLOOR_MS window), so
  // these tests drive the scheduled steps with mocked timers.
  beforeEach(() => mock.timers.enable());
  afterEach(() => mock.timers.reset());

  /** Advance one timer window per step -- node mock.timers fires chained timers
   *  one tick at a time (a timer scheduled inside another timer's callback runs
   *  on the *next* tick). 6 steps covers 4 queued casts + exhaust + slack. */
  const tickFullChain = (steps = 6) => {
    for (let i = 0; i < steps; i++) mock.timers.tick(800);
  };

  it('SUT_QUEUESTART arms the queue and chains all 5 slots, then ends', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100; // 5 casts * 5 FP = 25 FP
    for (let i = 0; i < 5; i++) p.hydrateSkills([{ slot: i, skillId: 100, level: 1 }]);
    for (let i = 0; i < 5; i++) p.m_aSlotQueue[i] = queueSlot(i);
    const m = makeService(new Map([[100, meleeSkill()]]), p);

    // Slot 0 is the SUT_QUEUESTART trigger; the service schedules slots 1..4.
    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 1 /* SUT_QUEUESTART */ });
    assert.equal(out.ok, true);
    assert.equal(m.calls.resolve, 1, 'only the trigger fires synchronously');

    tickFullChain();

    assert.equal(m.calls.resolve, 5, 'all 5 queued skills fired the damage pipeline');
    assert.equal(p.m_nUsedSkillQueue, -1, 'queue pointer reset after exhaust');
    assert.equal(p.m_queueTimer, undefined, 'pending timer cleared');
    assert.equal(p.m_nActionPoint, 100, 'v19 never decrements AP -- cost table is #ifndef __NEW_TASKBAR_V19 (UserTaskBar.cpp:211)');
    // v19 client has no case SNAPSHOTTYPE_SETACTIONPOINT handler (DPClient.cpp:608);
    // emitting 0x00c5 hits default:ASSERT(0) and desyncs the stream. Must be 0.
    const subTypes = m.sent.map((b) => b.readUInt16LE(14));
    assert.equal(subTypes.filter((s) => s === 0x00c5).length, 0, 'v19 forbids SETACTIONPOINT -- would crash client');
    assert.ok(subTypes.includes(SNAPSHOTTYPE_ENDSKILLQUEUE), 'ENDSKILLQUEUE ack sent on exhaust');
  });

  it('SUT_NORMAL (useType 0) does not arm or advance the queue', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    p.hydrateSkills([{ slot: 0, skillId: 100, level: 1 }]);
    p.m_aSlotQueue[0] = queueSlot(1); // would fire a 2nd skill if the queue ran
    const m = makeService(new Map([[100, meleeSkill({ id: 100 })]]), p);

    const out = m.service.cast(p, { wId: 0, objid: 999, useType: 0 });
    tickFullChain();

    assert.equal(out.ok, true);
    assert.equal(m.calls.resolve, 1, 'only the triggered skill runs');
    assert.equal(p.m_nUsedSkillQueue, -1, 'queue never armed');
    assert.equal(p.m_nActionPoint, 100, 'AP untouched');
  });

  it('ends the queue at the first empty slot', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    for (let i = 0; i < 5; i++) p.hydrateSkills([{ slot: i, skillId: 100, level: 1 }]);
    p.m_aSlotQueue[0] = queueSlot(0);
    p.m_aSlotQueue[1] = queueSlot(1);
    // slots 2..4 left empty (SHORTCUT.NONE) -> queue ends after slot 1.
    const m = makeService(new Map([[100, meleeSkill()]]), p);

    m.service.cast(p, { wId: 0, objid: 999, useType: 1 });
    tickFullChain();

    assert.equal(m.calls.resolve, 2, 'two skills fired before the empty slot ended the queue');
    assert.equal(p.m_nUsedSkillQueue, -1);
    assert.equal(p.m_nActionPoint, 100, 'v19 never decrements AP');
  });

  it('skips a queued skill whose cast fails and continues to the next', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    for (let i = 0; i < 5; i++) p.hydrateSkills([{ slot: i, skillId: 100, level: 1 }]);
    for (let i = 0; i < 5; i++) p.m_aSlotQueue[i] = queueSlot(i);
    const m = makeService(new Map([[100, meleeSkill()]]), p);
    // Slot 2 is on cooldown -> its queued cast fails and the chain skips it.
    p.m_tmReUseDelay[2] = Date.now() + 10_000;

    m.service.cast(p, { wId: 0, objid: 999, useType: 1 });
    tickFullChain();

    assert.equal(m.calls.resolve, 4, 'slots 0,1,3,4 fired; slot 2 was skipped');
    assert.equal(p.m_nUsedSkillQueue, -1);
  });

  it('ENDSKILLQUEUE cancel mid-chain stops the scheduled step', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nFp = 100;
    for (let i = 0; i < 5; i++) p.hydrateSkills([{ slot: i, skillId: 100, level: 1 }]);
    for (let i = 0; i < 5; i++) p.m_aSlotQueue[i] = queueSlot(i);
    const m = makeService(new Map([[100, meleeSkill()]]), p);

    m.service.cast(p, { wId: 0, objid: 999, useType: 1 });
    assert.equal(m.calls.resolve, 1);
    // Player cancels (mimics EndSkillQueueHandler clearing the timer + pointer).
    if (p.m_queueTimer !== undefined) {
      clearTimeout(p.m_queueTimer);
      p.m_queueTimer = undefined;
    }
    p.m_nUsedSkillQueue = -1;
    tickFullChain();

    assert.equal(m.calls.resolve, 1, 'no further skills fire after cancel');
    assert.equal(p.m_nUsedSkillQueue, -1);
  });
});
