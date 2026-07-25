/**
 * skillFormulas.ts test -- hand-computed expected outputs for one melee + one
 * magic skill using real converted resource data.
 *
 * Inputs are from `@flyff/resources`:
 *   - SI_VAG_ONE_CLEANHIT (id=1, EXT_MELEEATK): referStats=[1,0],
 *     referTargets=[1,0], referValues=[5,0]; L1 abilityMin=10 abilityMax=11.
 *   - SI_MAG_FIRE_FIRESTRIKE / Flame Ball (id=64, EXT_MAGICATKSHOT, ST_FIRE):
 *     referStats=[3,3], referTargets=[1,2], referValues=[20,1000];
 *     L1 abilityMin=41 abilityMax=42.
 *
 * Attacker: level=15, bare-hand (weapon min/max=0), STR=15 / INT=15.
 * Defender: NPC, npcArmor=20 -> calcDefense = floor(20/7)+1 = 3.
 *
 * Hand-computed:
 *   Clean Hit L1: nReferStat = floor(5/10)*15 + 1*floor(15/50) = 0
 *                 fPowerMin = (0 + 50 + 0 - 20) * 17/13 = 39.23 -> 39
 *                 fPowerMax = (0 + 55 + 0 - 20) * 17/13 = 45.77 -> 45
 *                 range [39,45]; damage = nATK - 3 (NPC def).
 *
 *   Flame Ball L1: nReferStat i=0 RT_ATTACK: floor(20/10)*15 + 1*0 = 30
 *                  i=1 RT_TIME skip (v1: RT_ATTACK only)
 *                  fPowerMin = (0 + 205 + 30 - 20) * 17/13 = 281.15 -> 281
 *                  fPowerMax = (0 + 210 + 30 - 20) * 17/13 = 287.69 -> 287
 *                  magic factor (FIRE=1 vs NO_PROP=0): 1.0
 *                  damage = floor((nATK - 3) * 1.0)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMeleeSkillPower,
  getMagicSkillPower,
  getMagicSkillFactor,
  postCalcMagicSkill,
  resolveSkillCast,
} from '../../src/combat/skillFormulas';
import type { Combatant, Rng } from '../../src/combat/formulas';
import { AF_GENERIC, AF_MELEESKILL, AF_MAGICSKILL, AF_CRITICAL1 } from '../../src/combat/tables';
import type { SkillDefinition } from '@flyff/resources';
import { loadSkills } from '@flyff/resources';
import { EMPTY_PARAM_VIEW } from '@flyff/entities';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RESOURCES_DATA = resolve(__dirname, '../../../resources/data');

let cleanHit: SkillDefinition | undefined;
let flameBall: SkillDefinition | undefined;
async function ensureSkills(): Promise<void> {
  if (cleanHit && flameBall) return;
  const idx = await loadSkills(RESOURCES_DATA);
  cleanHit = idx.skills.get(1);
  flameBall = idx.skills.get(64);
  assert.ok(cleanHit, 'SI_VAG_ONE_CLEANHIT (id=1) loaded');
  assert.ok(flameBall, 'Flame Ball (id=64) loaded');
}

function makeAttacker(over: Partial<Combatant> = {}): Combatant {
  return {
    kind: 'player',
    level: 15,
    job: 0,
    str: 15,
    sta: 15,
    dex: 15,
    int: 15,
    weapon: { min: 0, max: 0, type: 0, atkSpeed: 0.4, option: 0, element: 0 },
    npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0,
    npcHR: 0, npcER: 0,
    element: 0,
    equipDef: 0, adjHitRate: 0, parry: 0,
    params: EMPTY_PARAM_VIEW,
    ...over,
  };
}

function makeNpcDefender(over: Partial<Combatant> = {}): Combatant {
  return {
    kind: 'npc',
    level: 10,
    job: 0,
    str: 0, sta: 0, dex: 0, int: 0,
    weapon: { min: 0, max: 0, type: 0, atkSpeed: 0, option: 0, element: 0 },
    npcAtkMin: 0, npcAtkMax: 0,
    npcArmor: 20, npcResisMagic: 0,
    npcHR: 0, npcER: 0,
    element: 0,
    equipDef: 0, adjHitRate: 0, parry: 0,
    params: EMPTY_PARAM_VIEW,
    ...over,
  };
}

// `int` returns 99 so the 1% crit roll (getCriticalProb=1 at DEX 15, vagrant
// fCritical=1.0) never fires — these stubs isolate the base damage math.
/** Deterministic Rng stub — `range` returns `lo`, `int` returns 99 (no crit). */
const minRng: Rng = { int: () => 99, range: (lo: number) => lo };
/** Deterministic Rng stub — `range` returns `hi-1` (max), `int` returns 99 (no crit). */
const maxRng: Rng = { int: () => 99, range: (lo: number, hi: number) => hi - 1 };
/** Rng that always crits (`int` returns 0 < any positive crit prob). */
const critRng: Rng = { int: () => 0, range: (lo: number) => lo };

async function loadSkill(id: number): Promise<SkillDefinition> {
  await ensureSkills();
  if (id === 1) return cleanHit!;
  if (id === 64) return flameBall!;
  throw new Error(`unknown skill id ${id}`);
}

describe('getMagicSkillFactor', () => {
  it('same element = 1.1, beats = 0.9, else 1.0', () => {
    assert.equal(getMagicSkillFactor(1, 1), 1.1);          // Fire vs Fire
    assert.equal(getMagicSkillFactor(1, 2), 0.9);          // Fire beats Water
    assert.equal(getMagicSkillFactor(2, 3), 0.9);          // Water beats Electricity
    assert.equal(getMagicSkillFactor(3, 5), 0.9);          // Electricity beats Earth
    assert.equal(getMagicSkillFactor(5, 4), 0.9);          // Earth beats Wind
    assert.equal(getMagicSkillFactor(4, 1), 0.9);          // Wind beats Fire
    assert.equal(getMagicSkillFactor(1, 3), 1.0);          // Fire vs Electricity (no cycle)
    assert.equal(getMagicSkillFactor(2, 1), 1.0);          // Water vs Fire (reverse cycle)
  });
});

describe('getMeleeSkillPower — Clean Hit L1 (real data)', () => {
  it('produces the hand-computed [39, 45] range', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const attacker = makeAttacker();
    const { min, max } = getMeleeSkillPower(attacker, skill, level);
    assert.equal(min, 39, 'fPowerMin');
    assert.equal(max, 45, 'fPowerMax');
  });
});

describe('getMagicSkillPower — Flame Ball L1 (real data)', () => {
  it('produces the hand-computed [281, 287] range', async () => {
    const skill = await loadSkill(64);
    const level = skill.levels[0]!;
    const attacker = makeAttacker({ int: 15 });
    const { min, max } = getMagicSkillPower(attacker, skill, level);
    assert.equal(min, 281, 'fPowerMin');
    assert.equal(max, 287, 'fPowerMax');
  });
});

describe('postCalcMagicSkill', () => {
  it('subtracts defender DEF and applies element factor', () => {
    // nATK=281, nDEF=3, no defender element → factor 1.0 → 278
    assert.equal(postCalcMagicSkill(281, makeNpcDefender(), 3, 5), 278);
    // Same element (FIRE vs FIRE defender) → factor 1.1
    assert.equal(postCalcMagicSkill(100, makeNpcDefender({ element: 5 }), 10, 5), Math.floor(90 * 1.1));
    // Fire beats Water defender → factor 0.9
    assert.equal(postCalcMagicSkill(100, makeNpcDefender({ element: 7 }), 10, 5), Math.floor(90 * 0.9));
    // ATK below DEF clamps to 0
    assert.equal(postCalcMagicSkill(2, makeNpcDefender(), 3, 5), 0);
  });
});

describe('resolveSkillCast', () => {
  it('Clean Hit L1 melee: damage = nATK - 3, sets AF_MELEESKILL', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 39 - 3, 'min damage path');
    assert.equal(result.atkFlags & AF_MELEESKILL, AF_MELEESKILL, 'AF_MELEESKILL set');
    assert.equal(result.atkFlags & AF_MAGICSKILL, 0, 'AF_MAGICSKILL not set');
    assert.equal(result.atkFlags & AF_GENERIC, AF_GENERIC, 'AF_GENERIC base');
  });

  it('Clean Hit L1 with max rng hits the upper damage bound', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng: maxRng,
    });
    assert.equal(result.damage, 45 - 3, 'max damage path = 42');
  });

  it('Flame Ball L1 magic: damage = floor((nATK - 3) * 1.0), sets AF_MAGICSKILL', async () => {
    const skill = await loadSkill(64);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker({ int: 15 }),
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.hit, true);
    assert.equal(result.damage, 281 - 3, 'min magic damage path');
    assert.equal(result.atkFlags & AF_MAGICSKILL, AF_MAGICSKILL, 'AF_MAGICSKILL set');
    assert.equal(result.atkFlags & AF_MELEESKILL, 0, 'AF_MELEESKILL not set');
  });

  it('Flame Ball L1 vs FIRE defender applies 1.1 same-element factor', async () => {
    const skill = await loadSkill(64);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker({ int: 15 }),
      defender: makeNpcDefender({ element: 5 }), // FIRE
      skill, level, rng: minRng,
    });
    // nATK=281, nDEF=3 → 278; factor 1.1 → 305 (floor)
    assert.equal(result.damage, Math.floor(278 * 1.1));
  });

  it('Clean Hit: effectProc defaults true when skill has no nProbability', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    assert.equal(level.probability, undefined, 'fixture: Clean Hit has no probability');
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.effectProc, true, 'absent probability ⇒ always proc');
  });
});

describe('resolveSkillCast — skill crit', () => {
  it('crit sets AF_CRITICAL1 and multiplies nATK by 2.3 before DEF subtract', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // DEX 15, vagrant fCritical=1.0 → getCriticalProb = floor(1.5) = 1.
    // critRng.int()=0 < 1 ⇒ crit fires. nATK=39 (min) → floor(39*2.3)=89.
    // DEF 3 → 89 - 3 = 86.
    const attacker = makeAttacker({ dex: 15 });
    assert.equal(attacker.dex, 15);
    const result = resolveSkillCast({
      attacker,
      defender: makeNpcDefender(),
      skill, level, rng: critRng,
    });
    assert.equal(result.atkFlags & AF_CRITICAL1, AF_CRITICAL1, 'crit flag set');
    assert.equal(result.damage, Math.floor(39 * 2.3) - 3, '2.3× nATK then DEF subtract');
  });

  it('non-crit (int 99 ≥ prob) leaves AF_CRITICAL1 clear and uses base damage', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng: minRng, // int=99, no crit
    });
    assert.equal(result.atkFlags & AF_CRITICAL1, 0, 'no crit flag');
    assert.equal(result.damage, 39 - 3, 'plain base damage');
  });

  it('crit on a fully-blocked (0) hit clears AF_CRITICAL1', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // Defender armor huge → DEF ≥ nATK → nDamage 0 → crit flag cleared.
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender({ npcArmor: 10_000 }),
      skill, level, rng: critRng,
    });
    assert.equal(result.atkFlags & AF_CRITICAL1, 0, 'crit cleared on 0 damage');
    assert.equal(result.damage, 0);
  });
});

describe('resolveSkillCast — effect gate (nProbability)', () => {
  it('probability 50 + int 49 < 50 ⇒ effectProc true', async () => {
    const skill = await loadSkill(1);
    const level = { ...skill.levels[0]!, probability: 50 };
    const rng: Rng = { int: () => 49, range: (lo: number) => lo };
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng,
    });
    assert.equal(result.effectProc, true, '49 < 50 ⇒ proc');
  });

  it('probability 50 + int 50 ≥ 50 ⇒ effectProc false', async () => {
    const skill = await loadSkill(1);
    const level = { ...skill.levels[0]!, probability: 50 };
    const rng: Rng = { int: () => 50, range: (lo: number) => lo };
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng,
    });
    assert.equal(result.effectProc, false, '50 ≥ 50 ⇒ no proc');
  });

  it('probability 0 ⇒ never procs', async () => {
    const skill = await loadSkill(1);
    const level = { ...skill.levels[0]!, probability: 0 };
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng: critRng, // int 0, but prob 0 ⇒ 0 < 0 false
    });
    assert.equal(result.effectProc, false, 'prob 0 never procs');
  });
});

describe('resolveSkillCast — getDamageMultiplier applied', () => {
  it('PvP skill damage takes the 0.60 factor', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // Player vs player defender (same level ⇒ no cosine term), nATK=39, DEF 3.
    // Base 36 → floor(36 * 0.60) = 21.
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeAttacker({ npcArmor: 20 }), // kind 'player', calcDefense uses equip/level not npcArmor
      skill, level, rng: minRng,
    });
    // player defender calcDefense differs; assert factor bit: damage < base 36.
    assert.ok(result.damage < 36, `PvP multiplier shrinks damage (got ${result.damage})`);
  });

  it('PvE skill damage has NO level-diff cosine (C++ GetDamageMultiplier is skill-only)', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // A defender 15 levels above the attacker takes the SAME skill damage as a
    // same-level one -- C++ `GetDamageMultiplier` (MoverAttack.cpp:828) applies
    // only per-skill factors, never a level-diff cosine. NPC DEF (`armor/7+1`)
    // is level-independent, so both hits resolve to nATK 39 - DEF 3 = 36.
    const full = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender({ level: 30 }),
      skill, level, rng: minRng,
    });
    const near = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender({ level: 10 }),
      skill, level, rng: minRng,
    });
    assert.equal(near.damage, 36);
    assert.equal(full.damage, 36, 'higher-level NPC takes equal damage (no cosine falloff)');
  });
});
