/**
 * propMover.txt -> data/movers/*.yml converter.
 *
 * Source columns (subset we care about): dwID (MI_*), szName (IDS_PROPMOVER_*),
 * dwAI, dwStr/dwSta/dwDex/dwInt, dwHR/dwER, dwBelligerence, dwLevel, dwClass,
 * dwAtkMin/dwAtkMax, dwAttackSpeed, dwReAttackDelay, dwAddHp/dwAddMp,
 * dwNaturealArmor, fSpeed, dwExpValue, bKillable, bFlying.
 *
 * @module scripts/converters/movers
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parsePropTable, parseDefines, parseTxtTxt, readSource, num, type Row } from './parse.js';

/** Flee/heal AI data extracted from propMoverEx.inc per MI_* block. */
interface AiExtra {
  fleeHpPct: number;
  runawayDelay: number;
  healHpPct: number;
  healPct: number;
}

/**
 * Parse propMoverEx.inc for `SetRunAway`, `m_dwRunawayDelay`, and `Recovery`
 * lines inside each `MI_* { }` block. These live outside the `AI {}` sub-block
 * (SetRunAway/m_dwRunawayDelay) and inside the `#battle` section (Recovery).
 *
 * C++ field mapping:
 *   SetRunAway(HP%, MI_*, count) -> m_nFleeHpPct = HP%
 *   m_dwRunawayDelay = N         -> m_dwRunawayDelay = N
 *   Recovery HP How MP mode      -> m_nRecvCondMe=HP, m_nRecvCondHow=How,
 *                                   m_nRecvCondMP=MP, m_bRecvCondWho/cond=mode
 *     mode: u=other, m=self, a=both
 */
export function parseFleeHeal(content: string, miIds: Map<string, number>): Map<number, AiExtra> {
  const lines = content.split(/\r?\n/);
  const result = new Map<number, AiExtra>();

  let i = 0;
  // Skip header/template block (same as drops.ts).
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('MI_') && !t.startsWith('MVI_')) break;
  }

  for (; i < lines.length; i++) {
    const m = /^MI_(\w+)/.exec(lines[i].trim());
    if (!m) continue;
    const key = 'MI_' + m[1];
    const modelIdx = miIds.get(key);
    if (modelIdx === undefined) continue;

    let fleeHpPct = 0;
    let runawayDelay = 0;
    let healHpPct = 0;
    let healPct = 0;
    let inBattle = false;

    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (/^MI_\w+/.test(t)) break;

      // m_dwRunawayDelay = N (plain property, NOT inside AI block).
      const rd = /^m_dwRunawayDelay\s*=\s*(\d+)/.exec(t);
      if (rd) { runawayDelay = Number(rd[1]); continue; }

      // SetRunAway( HP%, ... ) -- first arg is the flee threshold %.
      const sr = /^SetRunAway\s*\(\s*(\d+)/.exec(t);
      if (sr) { fleeHpPct = Number(sr[1]); continue; }

      // Track when we enter the #battle section of the AI block.
      if (/^#battle/i.test(t)) { inBattle = true; continue; }
      // End of #battle section on next #label or closing brace at AI-block depth.
      if (inBattle && /^#\w/.test(t)) { inBattle = false; continue; }

      // Recovery inside #battle: `Recovery HP How MP [u|m|a]`
      // C++ (ProjectLux.cpp:155-184): m_nRecvCondMe=HP%, m_nRecvCondHow=How%,
      // m_nRecvCondMP=MP%. The letter sets m_bRecvCondWho (u=1/other, m=2/self,
      // a=3/both) and m_bRecvCond=2 (always heal).
      if (inBattle && /^Recovery\b/i.test(t)) {
        const nums: number[] = [];
        const reNum = /\d+/g;
        let nm: RegExpExecArray | null;
        while ((nm = reNum.exec(t)) !== null && nums.length < 3) {
          nums.push(Number(nm[0]));
        }
        if (nums.length >= 1) healHpPct = nums[0];
        if (nums.length >= 2) healPct = nums[1];
        // nums[2] is MP recovery % -- skip (MP regen not ported).
        // The letter (u/m/a) is always 'm' (self) in the Flaris data; we only
        // port self-heal. m_bRecvCond is inferred as 2 (always heal) when the
        // letter is present, but the entity's healHpPct > 0 gate covers it.
        continue;
      }
    }

    if (fleeHpPct > 0 || healHpPct > 0) {
      result.set(modelIdx, { fleeHpPct, runawayDelay, healHpPct, healPct });
    }
  }

  return result;
}

/** Skip the C++ template row -- not a real mover. */
const SKIP = new Set(['MI_DEFAULT']);

/**
 * propMover.txt `dwBelligerence` text -> numeric (defineAttribute.h:203-215).
 * The client's attack cursor is gated by `BELLI_PEACEFUL` (1), so the real
 * value must flow end-to-end instead of a hardcoded 0.
 */
const BELLI_TEXT_TO_NUM: Record<string, number> = {
  BELLI_PEACEFUL: 1,
  BELLI_CAUTIOUSATTACK: 2,
  BELLI_ACTIVEATTACK: 3,
  BELLI_ALLIANCE: 4,
  BELLI_ACTIVEATTACK_MELEE2X: 5,
  BELLI_ACTIVEATTACK_MELEE: 6,
  BELLI_ACTIVEATTACK_RANGE: 7,
  BELLI_CAUTIOUSATTACK_MELEE2X: 8,
  BELLI_CAUTIOUSATTACK_MELEE: 9,
  BELLI_CAUTIOUSATTACK_RANGE: 10,
  BELLI_MELEE2X: 11,
  BELLI_MELEE: 12,
  BELLI_RANGE: 13,
};

/** dwAI -> schema type. */
function classifyType(dwAi: string): 'monster' | 'npc' | 'player' {
  if (dwAi === 'AII_MONSTER') return 'monster';
  if (dwAi === 'AII_MOVER') return 'player'; // MI_MALE/MI_FEMALE + generic movers
  return 'npc';
}

/**
 * `dwClass` symbol -> numeric rank (`defineAttribute.h:184-194`). Kept as the
 * raw value (not collapsed to boss/giant) because `CMover::CanFlyByAttack`
 * (`MoverAttack.cpp:141`) discriminates RANK_SUPER/MATERIAL/MIDBOSS, which the
 * boolean flags below throw away.
 */
const RANK_TEXT_TO_NUM: Record<string, number> = {
  RANK_LOW: 1,
  RANK_NORMAL: 2,
  RANK_CAPTAIN: 3,
  RANK_BOSS: 4,
  RANK_MIDBOSS: 5,
  RANK_MATERIAL: 6,
  RANK_SUPER: 7,
  RANK_GUARD: 8,
  RANK_CITIZEN: 9,
};

/** dwClass rank -> boss/giant flags + type override. */
function rank(dwClass: string): { boss: boolean; giant: boolean } {
  return {
    boss: dwClass === 'RANK_BOSS',
    giant: dwClass === 'RANK_BOSS', // Flyff "boss" tier; giant is a server spawn variant
  };
}

interface MoverYml {
  _version: string;
  movers: Record<string, unknown>[];
}

function rowToMover(row: Row, id: number, name: string): Record<string, unknown> {
  const type = classifyType(row.dwAI);
  const { boss, giant } = rank(row.dwClass);
  const atkMin = num(row, 'dwAtkMin', 0);
  const atkMax = num(row, 'dwAtkMax', 0);

  return {
    id,
    // Persist the symbolic MI_* name so loaders can link NPC -> dialog prefix
    // (prefixForNpc strips `MI_` + lowercases -> `mafl_boboku` dialog file).
    key: row.dwID,
    name,
    name_id: row.szName,
    dwObjIndex: id,
    scale: 1.0,
    type: boss && type === 'monster' ? 'boss' : type,
    level: Math.max(1, Math.min(255, num(row, 'dwLevel', 1))),
    hp: Math.max(1, num(row, 'dwAddHp', 1)),
    mp: Math.max(0, num(row, 'dwAddMp', 0)),
    fp: 0,
    attack: Math.round((atkMin + atkMax) / 2),
    defense: num(row, 'dwNaturealArmor', 0),
    attack_rate: num(row, 'dwHR', 0),
    dodge_rate: num(row, 'dwER', 0),
    speed: num(row, 'fSpeed', 0),
    attack_speed: num(row, 'dwAttackSpeed', 0),
    re_attack_delay: num(row, 'dwReAttackDelay', 0),
    exp: num(row, 'dwExpValue', 0),
    flyable: row.bFlying === '1' || row.dwJumpIng === '1',
    boss,
    giant,
    raid: false,
    attackable: type === 'monster' ? row.bKillable !== '0' : false,
    guard: row.dwClass === 'RANK_GUARD',
    rank: RANK_TEXT_TO_NUM[row.dwClass] ?? 0,
    belligerence: BELLI_TEXT_TO_NUM[row.dwBelligerence] ?? 0,
  };
}

export async function convertMovers(rawDir: string, dataDir: string): Promise<void> {
  const [propMover, defineObj, txtTxt, propMoverEx] = await Promise.all([
    readSource(resolve(rawDir, 'propMover.txt')),
    readSource(resolve(rawDir, 'defineObj.h')),
    readSource(resolve(rawDir, 'propMover.txt.txt')),
    readSource(resolve(rawDir, 'propMoverEx.inc')).catch(() => ''),
  ]);

  const rows = parsePropTable(propMover);
  const miIds = parseDefines(defineObj, 'MI_');
  const names = parseTxtTxt(txtTxt);
  const aiExtras = propMoverEx ? parseFleeHeal(propMoverEx, miIds) : new Map<number, AiExtra>();

  const monsters: MoverYml = { _version: '1.0', movers: [] };
  const npcs: MoverYml = { _version: '1.0', movers: [] };
  const players: MoverYml = { _version: '1.0', movers: [] };

  let used = 0;
  let dropped = 0;
  let fleeCount = 0;
  let healCount = 0;
  for (const row of rows) {
    if (SKIP.has(row.dwID)) continue;
    const id = miIds.get(row.dwID);
    if (id === undefined) { dropped++; continue; }

    const name = names.get(row.szName) ?? row.dwID;
    const mover = rowToMover(row, id, name);

    // Merge flee/healer AI data from propMoverEx.inc.
    const ai = aiExtras.get(id);
    if (ai) {
      if (ai.fleeHpPct > 0) { mover.fleeHpPct = ai.fleeHpPct; fleeCount++; }
      if (ai.runawayDelay > 0) mover.runawayDelay = ai.runawayDelay;
      if (ai.healHpPct > 0) { mover.healHpPct = ai.healHpPct; healCount++; }
      if (ai.healPct > 0) mover.healPct = ai.healPct;
    }

    const type = classifyType(row.dwAI);
    if (type === 'monster') monsters.movers.push(mover);
    else if (row.dwID === 'MI_MALE' || row.dwID === 'MI_FEMALE') players.movers.push(mover);
    else npcs.movers.push(mover);
    used++;
  }

  const moversOut = resolve(dataDir, 'movers');
  await mkdir(moversOut, { recursive: true });
  await writeFile(resolve(moversOut, 'monsters.yml'), stringify(monsters));
  await writeFile(resolve(moversOut, 'npcs.yml'), header('# NPC / generic mover definitions -- generated from propMover.txt') + stringify(npcs));
  await writeFile(resolve(moversOut, 'player.yml'), header('# Player base stats -- generated from propMover.txt') + stringify(players));

  console.log(`  movers: ${used} written (${monsters.movers.length} monsters, ${npcs.movers.length} npcs, ${players.movers.length} player), ${dropped} without MI_ id dropped, ${fleeCount} flee, ${healCount} heal`);
}

function header(line: string): string {
  return `${line}\n`;
}
