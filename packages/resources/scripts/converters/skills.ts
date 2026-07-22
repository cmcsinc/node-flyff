/**
 * propSkill.txt + propSkillAdd.csv -> data/skills/<job>.yml converter.
 *
 * Two source files merged per the C++ loader (`ProjectCmn.cpp:300`,
 * `Project.cpp:2511`):
 *
 *   - `propSkill.txt` (UTF-16LE, tab-delimited, 124 cols): one row per skill,
 *     carries static base data (id, tier, job, element, referStats, cooldown
 *     fallback, subDefine anchor).
 *   - `propSkillAdd.csv` (UTF-8, comma, 36 cols): one row per skill level,
 *     joined to its parent via the `dwName` column (parent SI_* id).
 *
 * Per-level `=` inherit rules (Project.cpp:2571-2590): only 5 fields fall back
 * -- `dwAbilityMinPVP` <- `dwAbilityMin`, `dwAbilityMaxPVP` <- `dwAbilityMax`,
 * `nProbabilityPVP` <- `nProbability`, `dwActiveSkillRatePVP` <-
 * `dwActiveSkillRate`, `dwCooldown` <- base skill `dwSkillReady`. Every other
 * `=` resolves to 0 / empty (NULL_ID sentinel) for our purposes.
 *
 * @module scripts/converters/skills
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parsePropTable, parseDefines, parseTxtTxt, readSource, num, type Row } from './parse.js';

/** JOB_* (defineJob.h) -> output filename bucket. */
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

/**
 * EXT_* exeTarget values (defineSkill.h, docs #2). Hardcoded -- the raw header
 * is C++-side, not in `raw/defineAttribute.h` or `defineSkill.h` symbol form.
 */
void 0;

interface LevelRow {
  level: number;
  abilityMin?: number;
  abilityMax?: number;
  abilityMinPvp?: number;
  abilityMaxPvp?: number;
  probability?: number;
  probabilityPvp?: number;
  destParams?: number[];
  adjParamVals?: number[];
  chgParamVals?: number[];
  destData?: number[];
  reqMp?: number;
  reqFp?: number;
  cooldown?: number;
  castingTime?: number;
  skillRange?: number;
  skillTime?: number;
  skillCount?: number;
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

/** Resolve `JTYPE_BASE`/`JOB_VAGRANT`/`DST_STR` symbols to numbers. */
function symbol(defines: Map<string, number>, token: string | undefined): number | undefined {
  if (!token || token === '=' || token === '') return undefined;
  const n = Number(token);
  if (Number.isFinite(n)) return n;
  return defines.get(token);
}

/** Parse propSkillAdd.csv body (after the `//` header line). */
function parseAddCsv(content: string): Row[] {
  const lines = content.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith('//') && l.includes('dwName'));
  if (headerIdx === -1) throw new Error('propSkillAdd.csv header row not found');
  const cols = lines[headerIdx]
    .replace(/^\/\/+/, '')
    .split(',')
    .map((c) => c.trim());

  const rows: Row[] = [];
  const last: Record<string, string> = {};
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0 || line.startsWith('//')) continue;
    const cells = line.split(',');
    const row: Row = {};
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      let val = (cells[c] ?? '').trim();
      if (val === '=') val = last[col] ?? '';
      if (val.length > 0) {
        row[col] = val;
        last[col] = val;
      }
    }
    if (row.dwID && row.dwName) rows.push(row);
  }
  return rows;
}

/**
 * Apply the 5 `=` inherit rules. Returns a fresh row with PVP/cooldown fields
 * resolved against same-row non-PVP + the base skill's `dwSkillReady`.
 */
function applyInheritRules(
  raw: Row,
  baseCooldown: number,
): LevelRow {
  const abilityMin = num(raw, 'dwAbilityMin');
  const abilityMax = num(raw, 'dwAtkAbilityMax');
  const prob = num(raw, 'nProbability');
  // `=` already resolved to the previous row's literal value by parseAddCsv;
  // but the v15 merge rule is PVP<-SAME-ROW non-PVP when the PVP cell was `=`.
  // parseAddCsv preserved the `=` as previous-row inheritance, which is wrong
  // for the PVP columns (they want the SAME-ROW non-PVP value). We approximate
  // by always preferring the non-PVP value when PVP is missing/0.
  const abilityMinPvp = num(raw, 'dwAbilityMinPVP') || abilityMin;
  const abilityMaxPvp = num(raw, 'dwAbilityMaxPVP') || abilityMax;
  const probabilityPvp = num(raw, 'nProbabilityPVP') || prob;

  const cooldown = num(raw, 'dwCooldown') || baseCooldown;
  const castingTimeRaw = num(raw, 'dwCastingTime');
  // nVer<9 && castingTime!=`=`  ->  /=4  (Project.cpp:2584). propSkill version is 6.
  const castingTime = castingTimeRaw > 0 ? Math.floor(castingTimeRaw / 4) : castingTimeRaw;

  const level = num(raw, 'dwSkillLvl', 1);
  const lvl: LevelRow = { level };
  if (abilityMin) lvl.abilityMin = abilityMin;
  if (abilityMax) lvl.abilityMax = abilityMax;
  if (abilityMinPvp) lvl.abilityMinPvp = abilityMinPvp;
  if (abilityMaxPvp) lvl.abilityMaxPvp = abilityMaxPvp;
  if (prob) lvl.probability = prob;
  if (probabilityPvp) lvl.probabilityPvp = probabilityPvp;
  const dp1 = num(raw, 'dwDestParam1');
  const dp2 = num(raw, 'dwDestParam2');
  if (dp1 || dp2) lvl.destParams = [dp1, dp2].filter((v) => v !== 0);
  const av1 = num(raw, 'nAdjParamVal1');
  const av2 = num(raw, 'nAdjParamVal2');
  if (av1 || av2) lvl.adjParamVals = [av1, av2].filter((v) => v !== 0);
  const cv1 = num(raw, 'dwChgParamVal1');
  const cv2 = num(raw, 'dwChgParamVal2');
  if (cv1 || cv2) lvl.chgParamVals = [cv1, cv2].filter((v) => v !== 0);
  const dd1 = num(raw, 'dwdestData1');
  const dd2 = num(raw, 'dwdestData2');
  const dd3 = num(raw, 'dwdestData3');
  if (dd1 || dd2 || dd3) lvl.destData = [dd1, dd2, dd3].filter((v) => v !== 0);
  const reqMp = num(raw, 'dwReqMp');
  if (reqMp) lvl.reqMp = reqMp;
  const reqFp = num(raw, 'dwRepFp');
  if (reqFp) lvl.reqFp = reqFp;
  if (cooldown) lvl.cooldown = cooldown;
  if (castingTime) lvl.castingTime = castingTime;
  const range = num(raw, 'dwSkillRange');
  if (range) lvl.skillRange = range;
  const dur = num(raw, 'dwSkillTime');
  if (dur) lvl.skillTime = dur;
  const count = num(raw, 'dwSkillCount');
  if (count) lvl.skillCount = count;
  return lvl;
}

function rowToSkill(
  row: Row,
  id: number,
  name: string,
  defines: Map<string, number>,
  levels: LevelRow[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id,
    name,
    name_id: row.szName,
    tier: symbol(defines, row.dwItemKind1) ?? 0,
    job: symbol(defines, row.dwItemKind2) ?? 0,
    discipline: symbol(defines, row.dwItemKind3) ?? 0,
  };

  const wt = symbol(defines, row.dwWeaponType);
  if (wt !== undefined) out.weaponType = wt;
  const hd = symbol(defines, row.dwHanded);
  if (hd !== undefined) out.handed = hd;
  const ar = symbol(defines, row.dwAttackRange);
  if (ar !== undefined) out.attackRange = ar;

  const reqLevel = num(row, 'dwReqDisLV');
  if (reqLevel) out.reqLevel = reqLevel;

  const pre1 = symbol(defines, row.dwReSkill1);
  const pre1Lvl = num(row, 'dwReSkillLevel1');
  const pre2 = symbol(defines, row.dwReSkill2);
  const pre2Lvl = num(row, 'dwReSkillLevel2');
  const prereqs: Array<{ skill: number; level: number }> = [];
  if (pre1 !== undefined && pre1Lvl > 0) prereqs.push({ skill: pre1, level: pre1Lvl });
  if (pre2 !== undefined && pre2Lvl > 0) prereqs.push({ skill: pre2, level: pre2Lvl });
  if (prereqs.length) out.prereqs = prereqs;

  const sr = symbol(defines, row.dwSkillReadyType);
  if (sr !== undefined) out.cooldownType = sr;
  const baseCd = num(row, 'dwSkillReady');
  if (baseCd) out.baseCooldown = baseCd;

  const ext = symbol(defines, row.dwExeTarget);
  if (ext !== undefined) out.exeTarget = ext;
  const wui = symbol(defines, row.dwUseChance);
  if (wui !== undefined) out.useChance = wui;
  const sro = symbol(defines, row.dwSpellRegion);
  if (sro !== undefined) out.spellRegion = sro;
  const st = symbol(defines, row.dwSpellType);
  if (st !== undefined) out.element = st;

  out.resourceType = symbol(defines, row.dwSkillType) ?? 0;

  // Refer stats/targets/values are emitted as 2-element arrays. The C++ struct
  // has both slots; a missing (= empty) second slot is written as 0 so the
  // skill-formula can still index by position (single-stat skills like Clean
  // Hit only fill slot 0). Skip the array entirely only when no slot is set.
  const rs1 = symbol(defines, row.dwReferStat1);
  const rs2 = symbol(defines, row.dwReferStat2);
  if (rs1 !== undefined) out.referStats = [rs1, rs2 ?? 0];
  const rt1 = symbol(defines, row.dwReferTarget1);
  const rt2 = symbol(defines, row.dwReferTarget2);
  if (rt1 !== undefined) out.referTargets = [rt1, rt2 ?? 0];
  const rv1 = num(row, 'dwReferValue1');
  const rv2 = num(row, 'dwReferValue2');
  if (rv1 || rv2) out.referValues = [rv1, rv2];

  const sub = symbol(defines, row.dwSubDefine);
  if (sub !== undefined) out.subDefine = sub;

  const maxLvl = num(row, 'ExpertMax');
  out.maxLevel = maxLvl > 0 ? maxLvl : (levels.length || 1);

  const motion = symbol(defines, row.dwUseMotion);
  if (motion !== undefined) out.useMotion = motion;
  const sfx = symbol(defines, row.dwSfxElemental);
  if (sfx !== undefined) out.sfx = sfx;

  out.levels = levels;
  return out;
}

/** Group propSkillAdd rows by parent SI_*, sorted ascending by level. */
function groupLevels(addRows: Row[], baseCooldowns: Map<string, number>): Map<string, LevelRow[]> {
  const grouped = new Map<string, Row[]>();
  for (const r of addRows) {
    const parent = r.dwName!;
    let arr = grouped.get(parent);
    if (!arr) grouped.set(parent, (arr = []));
    arr.push(r);
  }
  const out = new Map<string, LevelRow[]>();
  for (const [parent, rows] of grouped) {
    rows.sort((a, b) => num(a, 'dwSkillLvl') - num(b, 'dwSkillLvl'));
    const baseCd = baseCooldowns.get(parent) ?? 0;
    out.set(parent, rows.map((r) => applyInheritRules(r, baseCd)));
  }
  return out;
}

export async function convertSkills(rawDir: string, dataDir: string): Promise<void> {
  const [
    propSkill, defineAttr, defineJob, defineSkill, txtTxt, propSkillAdd,
  ] = await Promise.all([
    readSource(resolve(rawDir, 'propSkill.txt')),
    readSource(resolve(rawDir, 'defineAttribute.h')),
    readSource(resolve(rawDir, 'defineJob.h')),
    readSource(resolve(rawDir, 'defineSkill.h')),
    readSource(resolve(rawDir, 'propSkill.txt.txt')),
    readSource(resolve(rawDir, 'propSkillAdd.csv')),
  ]);

  // Aggregate every `#define SYM value` we care about across all three headers.
  // First-wins: defineJob.h re-declares `JOB_VAGRANT` (=5) inside the master-tier
  // inner enum -- the base value (=0) is what skill rows reference, so keep the
  // first occurrence and ignore later ones.
  const defines = new Map<string, number>();
  const re = new RegExp(
    '^\\s*#define\\s+((?:SI_|DST_|ST_|SRO_|EXT_|WUI_|AR_|WT_|HD_|SR_|KT_|RT_|JTYPE_|JOB_|DIS_|XI_SKILL_)\\w+)\\s+(-?\\d+)',
    'gm',
  );
  for (const content of [defineAttr, defineJob, defineSkill]) {
    for (let m = re.exec(content); m !== null; m = re.exec(content)) {
      if (!defines.has(m[1]!)) defines.set(m[1]!, parseInt(m[2]!, 10));
    }
  }
  void parseDefines; // (parseDefines kept imported for parity; we use the inline regex above for first-wins)
  // Patch in hardcoded EXT_/WUI_ values (not exposed as symbols in raw headers;
  // docs skills-research.md #2).
  const HARDCODED: Record<string, number> = {
    EXT_SELFCHGPARAMET: 1, EXT_OBJCHGPARAMET: 2, EXT_MAGIC: 7,
    EXT_MAGICATK: 4, EXT_MAGICATKSHOT: 14, EXT_MELEEATK: 17, EXT_RANGEATK: 18,
    WUI_NOW: 1, WUI_TARGETOBJ: 2, WUI_TARGETINGOBJ: 4, WUI_TARGETMOVEOBJ: 7, WUI_MENU: 9,
  };
  for (const [k, v] of Object.entries(HARDCODED)) defines.set(k, v);

  const rows = parsePropTable(propSkill);
  const names = parseTxtTxt(txtTxt);
  const addRows = parseAddCsv(propSkillAdd);

  // First pass: collect base cooldowns (dwSkillReady) keyed by SI_* for the
  // per-level `dwCooldown` `=` fallback.
  const baseCooldowns = new Map<string, number>();
  for (const row of rows) {
    const cd = num(row, 'dwSkillReady');
    if (cd) baseCooldowns.set(row.dwID, cd);
  }

  const levelsByParent = groupLevels(addRows, baseCooldowns);

  let used = 0;
  let dropped = 0;
  let noBucket = 0;
  let totalLevels = 0;
  for (const row of rows) {
    const id = defines.get(row.dwID);
    if (id === undefined) { dropped++; continue; }

    const bucket = bucketFor(row.dwItemKind2 ?? '');
    if (!bucket) { noBucket++; continue; }

    const name = names.get(row.szName) ?? row.dwID;
    const levels = levelsByParent.get(row.dwID) ?? [];
    totalLevels += levels.length;
    bucket.skills.push(rowToSkill(row, id, name, defines, levels));
    used++;
  }

  const skillsOut = resolve(dataDir, 'skills');
  await mkdir(skillsOut, { recursive: true });
  for (const [file, yml] of buckets) {
    await writeFile(resolve(skillsOut, `${file}.yml`), stringify(yml));
  }

  console.log(
    `  skills: ${used} written across ${buckets.size} files, ${totalLevels} level rows, ` +
    `${dropped} without SI_ id, ${noBucket} non-class skills skipped`,
  );
}
