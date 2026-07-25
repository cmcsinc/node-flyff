/**
 * SkillDefinitionSchema test -- verifies the v19 schema parses a converted skill.
 *
 * Mirrors the on-disk layout from `data/skills/vagrant.yml`: Clean Hit is a
 * base-tier Vagrant melee skill (SI_VAG_ONE_CLEANHIT, id=1, 10 levels, FP
 * resource). All fields are real converted values; the parser must accept them
 * and fill defaults for omitted optionals.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { SkillDefinitionSchema, SkillFileSchema } from '../../src/schemas/skill.schema';

const MINIMAL = {
  id: 1,
  name: 'Clean Hit',
  name_id: 'IDS_PROPSKILL_TXT_000000',
  tier: 0,
  resourceType: 2,
} as const;

describe('SkillDefinitionSchema -- v19 fields', () => {
  it('parses a minimal skill with defaults', () => {
    const s = SkillDefinitionSchema.parse(MINIMAL);
    assert.equal(s.id, 1);
    assert.equal(s.tier, 0);
    assert.equal(s.resourceType, 2);
    assert.equal(s.maxLevel, 1, 'maxLevel defaults to 1');
    assert.deepEqual(s.levels, [], 'levels defaults to empty');
    assert.deepEqual(s.prereqs, [], 'prereqs defaults to empty');
    assert.equal(s.discipline, 0, 'discipline defaults to 0');
    assert.equal(s.reqLevel, 0, 'reqLevel defaults to 0');
  });

  it('parses a skill with levels[]', () => {
    const s = SkillDefinitionSchema.parse({
      ...MINIMAL,
      maxLevel: 10,
      levels: [
        { level: 1, abilityMin: 10, abilityMax: 11, reqFp: 5 },
        { level: 2, abilityMin: 12, abilityMax: 13, reqFp: 8 },
      ],
    });
    assert.equal(s.levels.length, 2);
    assert.equal(s.levels[0]!.abilityMin, 10);
    assert.equal(s.levels[1]!.reqFp, 8);
  });

  it('parses a magic skill with referStats/targets/values', () => {
    const s = SkillDefinitionSchema.parse({
      ...MINIMAL,
      id: 64,
      name: 'Flame Ball',
      tier: 1,
      job: 4,
      discipline: 15,
      element: 5,
      resourceType: 1,
      exeTarget: 14,
      referStats: [3, 3],
      referTargets: [1, 2],
      referValues: [20, 1000],
    });
    assert.deepEqual(s.referStats, [3, 3]);
    assert.deepEqual(s.referTargets, [1, 2]);
    assert.deepEqual(s.referValues, [20, 1000]);
    assert.equal(s.element, 5);
  });

  it('parses prereqs as { skill, level } pairs', () => {
    const s = SkillDefinitionSchema.parse({
      ...MINIMAL,
      prereqs: [{ skill: 121, level: 3 }, { skill: 158, level: 6 }],
    });
    assert.equal(s.prereqs.length, 2);
    assert.deepEqual(s.prereqs[0], { skill: 121, level: 3 });
  });

  it('rejects a negative tier', () => {
    assert.throws(() => SkillDefinitionSchema.parse({ ...MINIMAL, tier: -1 }));
  });
});

describe('SkillFileSchema -- converted vagrant.yml', () => {
  it('parses the real converted file with full levels[]', async () => {
    const path = resolve('data/skills/vagrant.yml');
    const raw = await readFile(path, 'utf8');
    const data = parse(raw);
    const file = SkillFileSchema.parse(data);

    assert.equal(file._job, 'vagrant');
    assert.ok(file.skills.length > 0, 'has at least one skill');

    const cleanHit = file.skills.find((s) => s.id === 1);
    assert.ok(cleanHit, 'Clean Hit (id=1) present');
    assert.equal(cleanHit!.tier, 0, 'JTYPE_BASE');
    assert.equal(cleanHit!.job, 0, 'JOB_VAGRANT');
    assert.equal(cleanHit!.resourceType, 2, 'KT_SKILL (FP)');
    assert.equal(cleanHit!.exeTarget, 17, 'EXT_MELEEATK');
    assert.equal(cleanHit!.maxLevel, 10);
    assert.equal(cleanHit!.levels.length, 10, '10 level rows');
    assert.equal(cleanHit!.levels[0]!.abilityMin, 10, 'L1 abilityMin');
    assert.equal(cleanHit!.levels[0]!.reqFp, 5, 'L1 FP cost');
  });
});
