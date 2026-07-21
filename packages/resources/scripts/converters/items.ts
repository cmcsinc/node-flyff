/**
 * propItem.txt → data/items/*.yml converter.
 *
 * Symbolic `II_*` ids (column `dwID`) resolve to numerics via defineItem.h.
 * Display names come from propItem.txt.txt via `szName` (IDS_PROPITEM_*).
 * Items are split into per-kind files by `dwItemKind1` / `dwItemKind2`.
 *
 * @module scripts/converters/items
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parsePropTable, parseDefines, parseTxtTxt, readSource, num, type Row } from './parse.js';

/** Flyff IK1_ kind → output filename + schema `_kind`. null = skip row. */
const KIND_BUCKETS: Record<string, { file: string; kind: string }> = {
  IK1_WEAPON: { file: 'weapons', kind: 'weapon' },
  IK1_ARMOR: { file: 'armors', kind: 'armor' },
  IK1_MAGIC: { file: 'consumables', kind: 'consumable' }, // spellbooks/consumable magic
  IK1_GENERAL: { file: 'materials', kind: 'material' },
};

/** IK2_WEAPON_DIRECT etc. are sub-kinds; bucket still keyed by IK1. */
const JOB_MAP: Record<string, string> = {
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

interface ItemYml {
  _version: string;
  _kind: string;
  items: Record<string, unknown>[];
}

const buckets = new Map<string, ItemYml>();

function bucketFor(kind1: string, kind2: string): ItemYml | null {
  // Refined kind from IK2 for weapons/armors, else IK1 bucket.
  let key = kind1;
  if (kind2 === 'IK2_MAGIC') key = 'IK1_MAGIC';
  const b = KIND_BUCKETS[key];
  if (!b) return null;
  let yml = buckets.get(b.file);
  if (!yml) {
    yml = { _version: '1.0', _kind: b.kind, items: [] };
    buckets.set(b.file, yml);
  }
  return yml;
}

function rowToItem(row: Row, id: number, name: string, kind1: string): Record<string, unknown> {
  const abilMin = num(row, 'dwAbilityMin', 0);
  const abilMax = num(row, 'dwAbilityMax', 0);
  const isWeapon = kind1 === 'IK1_WEAPON';
  const isArmor = kind1 === 'IK1_ARMOR';

  const item: Record<string, unknown> = {
    id,
    name,
    name_id: row.szName,
    weight: 1, // ponytail: real item weight isn't a direct propItem column
    price: num(row, 'dwCost', 0),
    sell_price: Math.floor(num(row, 'dwCost', 0) / 4),
    tradeable: true,
    dropable: true,
    destroyable: true,
  };

  if (isWeapon) {
    item.attack = Math.round((abilMin + abilMax) / 2);
    item.attack_rate = num(row, 'dwAttackSpeed', 0) / 100;
  } else if (isArmor) {
    item.defense = abilMin;
  }

  const dur = num(row, 'dwEndurance', 0);
  if (dur > 0) item.durability = dur;

  const job = JOB_MAP[row.dwItemJob];
  if (job) item.job_req = [job];

  const sex = num(row, 'dwItemSex', 0);
  if (sex === 1) item.gender_req = 'male';
  else if (sex === 2) item.gender_req = 'female';

  return item;
}

export async function convertItems(rawDir: string, dataDir: string): Promise<void> {
  const [propItem, defineItem, txtTxt] = await Promise.all([
    readSource(resolve(rawDir, 'propItem.txt')),
    readSource(resolve(rawDir, 'defineItem.h')),
    readSource(resolve(rawDir, 'propItem.txt.txt')),
  ]);

  const rows = parsePropTable(propItem);
  const iiIds = parseDefines(defineItem, 'II_');
  const names = parseTxtTxt(txtTxt);

  let used = 0;
  let dropped = 0;
  let noBucket = 0;
  for (const row of rows) {
    const id = iiIds.get(row.dwID);
    if (id === undefined) { dropped++; continue; }

    const kind1 = row.dwItemKind1;
    const kind2 = row.dwItemKind2 ?? '';
    const bucket = bucketFor(kind1, kind2);
    if (!bucket) { noBucket++; continue; }

    const name = names.get(row.szName) ?? row.dwID;
    bucket.items.push(rowToItem(row, id, name, kind1));
    used++;
  }

  const itemsOut = resolve(dataDir, 'items');
  await mkdir(itemsOut, { recursive: true });
  for (const [file, yml] of buckets) {
    await writeFile(resolve(itemsOut, `${file}.yml`), stringify(yml));
  }

  console.log(`  items: ${used} written across ${buckets.size} files, ${dropped} without II_ id, ${noBucket} non-equipment skipped`);
}
