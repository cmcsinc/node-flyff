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
import { EMPTY_PARAM_VIEW, DST } from '@flyff/entities';
import type { ParamView } from '@flyff/entities';

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
    equipDef: 0, equipDefMax: 0, adjHitRate: 0, parry: 0,
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
    equipDef: 0, equipDefMax: 0, adjHitRate: 0, parry: 0,
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
  // Both operands are the ATTACKER's: (skillElement, weaponElement).
  // `GetMagicSkillFactor` (MoverAttack.cpp:1139) never reads pDefender.
  it('same element = 1.1, skill beats weapon = 0.9, else 1.0', () => {
    assert.equal(getMagicSkillFactor(1, 1), 1.1);          // Fire skill, fire wand
    assert.equal(getMagicSkillFactor(1, 2), 0.9);          // Fire skill, water wand
    assert.equal(getMagicSkillFactor(2, 3), 0.9);          // Water skill, electric wand
    assert.equal(getMagicSkillFactor(3, 5), 0.9);          // Electric skill, earth wand
    assert.equal(getMagicSkillFactor(5, 4), 0.9);          // Earth skill, wind wand
    assert.equal(getMagicSkillFactor(4, 1), 0.9);          // Wind skill, fire wand
    assert.equal(getMagicSkillFactor(1, 3), 1.0);          // Fire skill, electric wand
    assert.equal(getMagicSkillFactor(2, 1), 1.0);          // Water skill, fire wand
  });

  it('no weapon element = 1.0 (C++ returns 1.0f with no item prop)', () => {
    assert.equal(getMagicSkillFactor(1, 0), 1.0);
    assert.equal(getMagicSkillFactor(0, 0), 1.0);
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

/** Attacker holding a wand whose element is `el` (ePropType 1..5, 0 = none). */
function makeWandAttacker(el: number): Combatant {
  return makeAttacker({
    weapon: { min: 0, max: 0, type: 0, atkSpeed: 0.4, option: 0, element: el },
  });
}

describe('postCalcMagicSkill', () => {
  it('subtracts defender DEF and applies the attacker-weapon element factor', () => {
    // Skill element is an ST_* bit flag (ST_FIRE=0x04); the weapon element is
    // already ePropType (FIRE=1, WATER=2).
    // nATK=281, nDEF=3, bare hands → factor 1.0 → 278
    assert.equal(postCalcMagicSkill(281, makeAttacker(), makeNpcDefender(), 3, 0x04), 278);
    // Fire skill from a FIRE wand → 1.1 synergy
    assert.equal(
      postCalcMagicSkill(100, makeWandAttacker(1), makeNpcDefender(), 10, 0x04),
      Math.floor(90 * 1.1),
    );
    // Fire skill from a WATER wand → 0.9 (skill beats weapon in the cycle)
    assert.equal(
      postCalcMagicSkill(100, makeWandAttacker(2), makeNpcDefender(), 10, 0x04),
      Math.floor(90 * 0.9),
    );
    // ATK below DEF clamps to 0
    assert.equal(postCalcMagicSkill(2, makeAttacker(), makeNpcDefender(), 3, 0x04), 0);
  });

  it('ignores the DEFENDER element entirely (MoverAttack.cpp:1139)', () => {
    // A fire spell into a fire monster is NOT 1.1x -- the old model read the
    // defender here. Only GetResist(skillType) consults the defender, and an
    // NPC with no DST_RESIST_FIRE resists nothing.
    const fireDefender = makeNpcDefender({ element: 0x04 });
    assert.equal(
      postCalcMagicSkill(100, makeAttacker(), fireDefender, 10, 0x04),
      90,
      'bare-hands caster: factor stays 1.0 regardless of defender element',
    );
    assert.equal(
      postCalcMagicSkill(100, makeWandAttacker(1), fireDefender, 10, 0x04),
      postCalcMagicSkill(100, makeWandAttacker(1), makeNpcDefender({ element: 0x20 }), 10, 0x04),
      'same wand + skill → same factor whatever the defender is',
    );
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
    // `Ctrl.cpp:1024-1031` sets ONLY AF_MELEESKILL/AF_MAGICSKILL on a skill
    // attack -- never AF_GENERIC. Its absence is what routes a melee skill to
    // POSTCALC_DPC (`GetPostCalcType`, AttackArbiter.cpp:434-450).
    assert.equal(result.atkFlags & AF_GENERIC, 0, 'AF_GENERIC must be clear');
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

  it('Flame Ball L1 from a FIRE wand applies the 1.1 same-element factor', async () => {
    const skill = await loadSkill(64);
    const level = skill.levels[0]!;
    // Flame Ball's dwSpellType resolves to ST_FIRE = 0x04 (v19 bit flag).
    // The factor is skill-element vs the ATTACKER'S WEAPON element
    // (`GetMagicSkillFactor`, MoverAttack.cpp:1139 reads `GetWeaponItem()->
    // m_bItemResist` / `GetActiveHandItemProp()->eItemType`), so a fire wand is
    // what earns the bonus -- the defender's element is never consulted.
    const result = resolveSkillCast({
      attacker: makeAttacker({
        int: 15,
        weapon: { min: 0, max: 0, type: 0, atkSpeed: 0.4, option: 0, element: 1 }, // FIRE
      }),
      defender: makeNpcDefender({ element: 0x20 }), // ST_WATER -- irrelevant
      skill, level, rng: minRng,
    });
    // nATK=281, nDEF=3 → 278; factor 1.1 → 305 (floor)
    assert.equal(result.damage, Math.floor(278 * 1.1));
  });

  it('Flame Ball L1 bare-handed gets no factor even against a FIRE defender', async () => {
    const skill = await loadSkill(64);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker({ int: 15 }), // weapon element 0 -> C++ returns 1.0f
      defender: makeNpcDefender({ element: 0x04 }), // ST_FIRE
      skill, level, rng: minRng,
    });
    assert.equal(result.damage, 278, 'factor 1.0 -- the old model gave 305 here');
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

describe('resolveSkillCast — skills never crit (C++ IsCriticalAttack returns FALSE for skills)', () => {
  it('even with critRng, no AF_CRITICAL1 and no damage boost', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // critRng.int()=0 would trigger crit on melee, but skills skip IsCriticalAttack.
    // nATK=39 (min) → DEF 3 → 36. No 2.3× multiplier.
    const result = resolveSkillCast({
      attacker: makeAttacker({ dex: 15 }),
      defender: makeNpcDefender(),
      skill, level, rng: critRng,
    });
    assert.equal(result.atkFlags & AF_CRITICAL1, 0, 'no crit flag on skills');
    assert.equal(result.damage, 39 - 3, 'plain base damage, no crit multiplier');
  });

  it('non-crit rng also produces no AF_CRITICAL1 and base damage', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.atkFlags & AF_CRITICAL1, 0, 'no crit flag');
    assert.equal(result.damage, 39 - 3, 'plain base damage');
  });

  it('blocked skill hit has 0 damage and no AF_CRITICAL1', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender({ npcArmor: 10_000 }),
      skill, level, rng: critRng,
    });
    assert.equal(result.atkFlags & AF_CRITICAL1, 0, 'no crit flag on skills');
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

  it('PvE skill damage takes the v19 level-diff cosine (skills are NOT exempt)', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // v19 GetDamageMultiplier applies cos(pi*nDelta/32) for NPC defenders too;
    // skill damage rides the same pipeline as melee. NPC DEF (armor/7+1 = 3) is
    // level-independent, so base = nATK 39 - DEF 3 = 36 regardless of level.
    // Same-level (nDelta=0): no cosine, full 36. L30 NPC vs L15 attacker:
    // nDelta=15 -> cap 15 -> factor cos(15pi/32) ~0.098 -> floor(36*0.098)=3.
    const same = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender({ level: 15 }),
      skill, level, rng: minRng,
    });
    assert.equal(same.damage, 36, 'same-level NPC takes full skill damage (no cosine)');
    const higher = resolveSkillCast({
      attacker: makeAttacker(),
      defender: makeNpcDefender({ level: 30 }),
      skill, level, rng: minRng,
    });
    const expected = Math.floor(36 * Math.cos((Math.PI * 15) / 32));
    assert.equal(higher.damage, expected, 'higher-level NPC takes cosine-reduced skill damage');
  });
});

describe('resolveSkillCast — DST_ATKPOWER_RATE (GetATKMultiplier)', () => {
  it('applies ATKPOWER_RATE +10% to skill nATK before defense subtract', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    // ATKPOWER_RATE = 10 → multiplier 1.1
    const paramsWithRate: ParamView = {
      get: (dst: number, def: number) => dst === DST.ATKPOWER_RATE ? 10 : def,
    };
    // Clean Hit L1: nATK=39 (minRng), *1.1 = floor(42.9)=42, -3 DEF = 39
    const result = resolveSkillCast({
      attacker: makeAttacker({ params: paramsWithRate }),
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.damage, 39, 'floor(39*1.1) - 3 DEF = 39');
  });

  it('applies ATKPOWER_RATE to magic skills too', async () => {
    const skill = await loadSkill(64);
    const level = skill.levels[0]!;
    const paramsWithRate: ParamView = {
      get: (dst: number, def: number) => dst === DST.ATKPOWER_RATE ? 10 : def,
    };
    // Flame Ball L1: nATK=281, *1.1 = floor(309.1)=309, -3 DEF = 306, factor 1.0
    const result = resolveSkillCast({
      attacker: makeAttacker({ int: 15, params: paramsWithRate }),
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.damage, 306, 'floor(281*1.1) - 3 DEF = 306');
  });

  it('zero ATKPOWER_RATE has no effect', async () => {
    const skill = await loadSkill(1);
    const level = skill.levels[0]!;
    const result = resolveSkillCast({
      attacker: makeAttacker(), // EMPTY_PARAM_VIEW returns 0
      defender: makeNpcDefender(),
      skill, level, rng: minRng,
    });
    assert.equal(result.damage, 36, 'no rate → same as before (39-3)');
  });
});
