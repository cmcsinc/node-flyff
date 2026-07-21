/**
 * propSkill.txt → data/skills/*.yml converter.
 *
 * propSkill.txt reuses the propItem tabular shape but carries skill base data:
 * dwID=SI_*, szName=IDS_PROPSKILL_*, dwItemKind1=JTYPE_* (tree),
 * dwItemKind2=JOB_* (job), dwItemKind3=DIS_* (display group).
 *
 * Per-level scaling (MP/FP cost, damage) lives in propSkillAdd.csv and is NOT
 * merged here — each skill ships with a single placeholder level until that
 * parser lands. `ponytail: merge propSkillAdd.csv for real per-level stats`.
 *
 * @module scripts/converters/skills
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parsePropTable, parseDefines, parseTxtTxt, readSource, type Row } from './parse.js';

/** JOB_* → output filename (one file per job). */
const JOB_FILES: Record<string, string> = {
  JOB_VAGRANT: 'vagrant',
  JOB_MERCENARY: 'mercenary',
  JOB_ACROBAT: 'acrobat',
  JOB_ASSIST: 'assist',
  JOB_MAGICIAN: 'magician',
  JOB_SWORD: 'blade',
  JOB_KNIGHT: 'knight',
  JOB_JESTER: 'jester',
  JOB_BILLPOSTER: 'billposter',
  JOB_RINGMASTER: 'ringmaster',
  JOB_RANGER: 'ranger',
  JOB_ELEMENTOR: 'elementor',
  JOB_PSYCHIKEEPER: 'psykeeper',
};

/** JTYPE_* → schema SkillTypeEnum. Default `active`. */
function skillType(jtype: string): 'passive' | 'active' | 'buff' | 'attack' {
  if (jtype === 'JTYPE_CHEAT') return 'buff';
  if (jtype === 'JTYPE_BASE') return 'passive';
  return 'active';
}

interface SkillYml {
  _version: string;
  _job: string;
  skills: Record<string, unknown>[];
}

const buckets = new Map<string, SkillYml>();

function bucketFor(job: string): SkillYml | null {
  const file = JOB_FILES[job];
  if (!file) return null;
  let yml = buckets.get(file);
  if (!yml) {
    yml = { _version: '1.0', _job: file, skills: [] };
    buckets.set(file, yml);
  }
  return yml;
}

function rowToSkill(row: Row, id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    name_id: row.szName,
    type: skillType(row.dwItemKind1),
    level_req: 1,
    skill_points: 1,
    max_level: 1, // ponytail: real max from propSkillAdd.csv
    levels: [{ level: 1 }],
  };
}

export async function convertSkills(rawDir: string, dataDir: string): Promise<void> {
  const [propSkill, defineSkill, txtTxt] = await Promise.all([
    readSource(resolve(rawDir, 'propSkill.txt')),
    readSource(resolve(rawDir, 'defineSkill.h')),
    readSource(resolve(rawDir, 'propSkill.txt.txt')),
  ]);

  const rows = parsePropTable(propSkill);
  const siIds = parseDefines(defineSkill, 'SI_');
  const names = parseTxtTxt(txtTxt);

  let used = 0;
  let dropped = 0;
  let noBucket = 0;
  for (const row of rows) {
    const id = siIds.get(row.dwID);
    if (id === undefined) { dropped++; continue; }

    const bucket = bucketFor(row.dwItemKind2 ?? '');
    if (!bucket) { noBucket++; continue; }

    const name = names.get(row.szName) ?? row.dwID;
    bucket.skills.push(rowToSkill(row, id, name));
    used++;
  }

  const skillsOut = resolve(dataDir, 'skills');
  await mkdir(skillsOut, { recursive: true });
  for (const [file, yml] of buckets) {
    await writeFile(resolve(skillsOut, `${file}.yml`), stringify(yml));
  }

  console.log(`  skills: ${used} written across ${buckets.size} files, ${dropped} without SI_ id, ${noBucket} non-class skills skipped`);
}
