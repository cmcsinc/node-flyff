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
    belligerence: BELLI_TEXT_TO_NUM[row.dwBelligerence] ?? 0,
  };
}

export async function convertMovers(rawDir: string, dataDir: string): Promise<void> {
  const [propMover, defineObj, txtTxt] = await Promise.all([
    readSource(resolve(rawDir, 'propMover.txt')),
    readSource(resolve(rawDir, 'defineObj.h')),
    readSource(resolve(rawDir, 'propMover.txt.txt')),
  ]);

  const rows = parsePropTable(propMover);
  const miIds = parseDefines(defineObj, 'MI_');
  const names = parseTxtTxt(txtTxt);

  const monsters: MoverYml = { _version: '1.0', movers: [] };
  const npcs: MoverYml = { _version: '1.0', movers: [] };
  const players: MoverYml = { _version: '1.0', movers: [] };

  let used = 0;
  let dropped = 0;
  for (const row of rows) {
    if (SKIP.has(row.dwID)) continue;
    const id = miIds.get(row.dwID);
    if (id === undefined) { dropped++; continue; }

    const name = names.get(row.szName) ?? row.dwID;
    const mover = rowToMover(row, id, name);

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

  console.log(`  movers: ${used} written (${monsters.movers.length} monsters, ${npcs.movers.length} npcs, ${players.movers.length} player), ${dropped} without MI_ id dropped`);
}

function header(line: string): string {
  return `${line}\n`;
}
