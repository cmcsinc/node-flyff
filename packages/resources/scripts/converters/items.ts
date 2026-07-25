/**
 * propItem.txt -> data/items/*.yml converter.
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

/** Flyff IK1_ kind -> output filename + schema `_kind`. null = skip row. */
const KIND_BUCKETS: Record<string, { file: string; kind: string }> = {
  IK1_WEAPON: { file: 'weapons', kind: 'weapon' },
  IK1_ARMOR: { file: 'armors', kind: 'armor' },
  IK1_MAGIC: { file: 'consumables', kind: 'consumable' }, // spellbooks/consumable magic
  IK1_GENERAL: { file: 'materials', kind: 'material' },
  // Accessories share no IK1 -- routed by IK3 in bucketFor.
  _JEWELRY: { file: 'jewelry', kind: 'jewelry' },
};

/** IK2_WEAPON_DIRECT etc. are sub-kinds; bucket still keyed by IK1. */
/** propItem `dwDestParam*` -> YAML restore field (consumables only). */
const RESTORE_DST: Record<string, 'hp_restore' | 'mp_restore' | 'fp_restore'> = {
  DST_HP: 'hp_restore',
  DST_MP: 'mp_restore',
  DST_FP: 'fp_restore',
};

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

function bucketFor(kind1: string, kind2: string, kind3: string): ItemYml | null {
  // Refined kind from IK2 for weapons/armors, else IK1 bucket.
  let key = kind1;
  if (kind2 === 'IK2_MAGIC') key = 'IK1_MAGIC';
  // Buff scrolls (IK2_BUFF/IK2_BUFF2) live under IK1_SYSTEM, which has no bucket
  // (IK2_SYSTEM server-internal items are intentionally skipped). Route them to
  // consumables so UseItemService can apply their DST effects + timed duration.
  if (kind2 === 'IK2_BUFF' || kind2 === 'IK2_BUFF2') key = 'IK1_MAGIC';
  let b = KIND_BUCKETS[key];
  // Accessories (ring/earring/necklace) share no IK1 -- route by IK3.
  if (!b && (kind3 === 'IK3_RING' || kind3 === 'IK3_EARRING' || kind3 === 'IK3_NECKLACE')) {
    b = KIND_BUCKETS._JEWELRY;
  }
  if (!b) return null;
  let yml = buckets.get(b.file);
  if (!yml) {
    yml = { _version: '1.0', _kind: b.kind, items: [] };
    buckets.set(b.file, yml);
  }
  return yml;
}

function rowToItem(
  row: Row,
  id: number,
  name: string,
  kind1: string,
  partsMap: Map<string, number>,
  dstMap: Map<string, number>,
): Record<string, unknown> {
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
    stack_size: Math.max(1, num(row, 'dwPackMax', 1)),
  };

  // Kind routing -- read before equip_slot so consumables can be excluded.
  if (row.dwItemKind2) item.item_kind2 = row.dwItemKind2;
  if (row.dwItemKind3) item.item_kind3 = row.dwItemKind3;

  // Equip slot / weapon type -- raw propItem columns.
  // `dwParts` is a `PARTS_*` symbol (defineNeuz.h), not a raw int -- resolve via map,
  // else EquipService rejects every equip with `not_equippable` (client sends numeric nPart).
  // Gate to real gear: weapons/armors/accessories. Consumables carry a stale dwParts too --
  // copying it makes UseItemService route them through EquipService (equip_slot check fires
  // before the IK2_POTION branch) and silently drop the consume.
  const kind3 = row.dwItemKind3 ?? '';
  const isEquippable =
    kind1 === 'IK1_WEAPON' || kind1 === 'IK1_ARMOR' ||
    kind3 === 'IK3_RING' || kind3 === 'IK3_EARRING' || kind3 === 'IK3_NECKLACE';
  if (isEquippable) {
    const partsSym = row.dwParts;
    const parts = (partsSym && partsMap.get(partsSym)) ?? num(row, 'dwParts', 0);
    if (parts > 0) item.equip_slot = parts;
  }
  // Fashion (costume) items live in their own equip window: PARTS_HAT/CLOTH/
  // GLOVE/BOOTS (26..29) -- the client renders the fashion layer from those slots
  // (`Mover.cpp:9123` nArryEquip2). Some legacy `_CLO_` rows carry an ARMOR parts
  // value (PARTS_CAP=6, PARTS_UPPER_BODY=2, ...) which collides with real armor
  // (user: "fashion helmet equipped on armor helmet slot"). Remap by IK3 so a
  // costume always lands in the fashion window, regardless of the raw dwParts.
  const fashionParts: Record<string, number> = {
    IK3_HAT: 26, IK3_CLOTH: 27, IK3_GLOVE: 28, IK3_BOOTS: 29, IK3_SHOES: 29,
  };
  if ((item.item_kind2 === 'IK2_CLOTHETC' || item.item_kind2 === 'IK2_CLOTH') &&
      item.item_kind3 && fashionParts[item.item_kind3] !== undefined) {
    item.equip_slot = fashionParts[item.item_kind3];
  }
  const weaponType = num(row, 'dwWeaponType', 0);
  if (weaponType > 0) item.weapon_type = weaponType;

  // Consumable vitals -- propItem dwDestParam{1-3} (DST_HP/MP/FP) + nAdjParamVal{1-3}.
  // Without these, ConsumableService heals 0 and the charge is wasted.
  for (let i = 1; i <= 3; i++) {
    const field = RESTORE_DST[row[`dwDestParam${i}`]];
    if (field) {
      const val = num(row, `nAdjParamVal${i}`, 0);
      if (val > 0) item[field] = val;
    }
  }

  // Consumable cooldown -- propItem dwSkillReady (= ItemProp::GetCoolTime, ms).
  // Drives the group cooldown gate in UseItemService (CooltimeMgr.h). Gated by
  // IK2 kind to match C++ GetGroup: the propItem `=` inherit rule otherwise
  // leaks dwSkillReady across kind boundaries (cloaks inherit 1500 from an
  // earlier food row). HP potions carry 0 in the source, so they fall back to
  // the config default at runtime.
  const COOLDOWN_KINDS = new Set(['IK2_FOOD', 'IK2_SKILL', 'IK2_POTION']);
  if (row.dwItemKind2 && COOLDOWN_KINDS.has(row.dwItemKind2)) {
    const cooltime = num(row, 'dwSkillReady', 0);
    if (cooltime > 0) item.cooldown_ms = cooltime;
  }

  // Jewelry HR/ER columns (propItem nAdjHitRate + dwParry). Zero for non-jewelry;
  // the combat stat-fold reads these once accessory data lands in the index.
  const hr = num(row, 'nAdjHitRate', 0);
  if (hr > 0) item.hit_rate = hr;
  const parry = num(row, 'dwParry', 0);
  if (parry > 0) item.parry = parry;

  // DST effects from the propItem dwDestParam{1-3}/nAdjParamVal{1-3}/dwChgParamVal{1-3}
  // triplets -- the ONLY way items carry +STR/+STA/+DEX/+INT/+ADJDEF/+HP_MAX/etc
  // (no dedicated stat columns exist). Resolved to numeric DST ids via
  // defineAttribute.h. Two carriers share the same triplet format:
  //  - equippable gear: applied to the wearer's ParamModel on equip (C++
  //    SetDestParam per item, MoverParam.cpp:2221). Vital restores
  //    (DST_HP/MP/FP) on food/potions are NOT read here -- the RESTORE_DST loop
  //    above folds those into hp_restore/mp_restore/fp_restore (different consumer).
  //  - buff scrolls (IK2_BUFF/IK2_BUFF2): applied as a timed item-buff on consume
  //    (UseItemService IK2_BUFF branch -> BuffManager.addItemBuff). Their DST is
  //    everything-except-HP/MP/FP (e.g. DST_STR on II_SYS_SYS_SCR_STR).
  const kind2 = row.dwItemKind2 ?? '';
  const isBuffItem = kind2 === 'IK2_BUFF' || kind2 === 'IK2_BUFF2';
  if (isEquippable || isBuffItem) {
    const effects: Array<{ dst: number; adj: number; chg?: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const sym = row[`dwDestParam${i}`];
      if (!sym) continue;
      const dst = dstMap.get(sym);
      if (dst === undefined) continue; // unknown / unsupported DST symbol
      // Skip pure vital-restore DST on buff items -- potions already fold those
      // into hp_restore/mp_restore/fp_restore above; emitting them again here would
      // double-apply as a timed DST_HP buff on top of the instant restore.
      if (isBuffItem && (sym === 'DST_HP' || sym === 'DST_MP' || sym === 'DST_FP')) continue;
      const adj = num(row, `nAdjParamVal${i}`, 0);
      const chg = num(row, `dwChgParamVal${i}`, 0);
      if (adj !== 0) effects.push({ dst, adj });
      else if (chg !== 0) effects.push({ dst, adj: 0, chg });
    }
    if (effects.length > 0) item.effects = effects;
  }

  // Buff duration -- propItem `dwSkillTime` (ms). C++ ApplyParam reads the same
  // field for the CBuffItem timer (MoverActEvent.cpp:213,221). Stored in seconds
  // (schema item.schema.ts duration) -> UseItemService multiplies back to ms.
  if (isBuffItem) {
    const durMs = num(row, 'dwSkillTime', 0);
    if (durMs > 0) item.duration = Math.round(durMs / 1000);
  }

  if (isWeapon) {
    item.attack = Math.round((abilMin + abilMax) / 2);
    item.attack_rate = num(row, 'dwAttackSpeed', 0) / 100;
    item.attack_min = abilMin;
    item.attack_max = abilMax;
    item.attack_speed = num(row, 'dwAttackSpeed', 0);
  } else if (isArmor) {
    item.defense = abilMin;
    item.attack_min = abilMin;
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
  const [propItem, defineItem, defineNeuz, defineAttr, txtTxt] = await Promise.all([
    readSource(resolve(rawDir, 'propItem.txt')),
    readSource(resolve(rawDir, 'defineItem.h')),
    readSource(resolve(rawDir, 'defineNeuz.h')),
    readSource(resolve(rawDir, 'defineAttribute.h')),
    readSource(resolve(rawDir, 'propItem.txt.txt')),
  ]);

  const rows = parsePropTable(propItem);
  const iiIds = parseDefines(defineItem, 'II_');
  const partsMap = parseDefines(defineNeuz, 'PARTS_');
  const dstMap = parseDefines(defineAttr, 'DST_');
  const names = parseTxtTxt(txtTxt);

  let used = 0;
  let dropped = 0;
  let noBucket = 0;
  for (const row of rows) {
    const id = iiIds.get(row.dwID);
    if (id === undefined) { dropped++; continue; }

    const kind1 = row.dwItemKind1;
    const kind2 = row.dwItemKind2 ?? '';
    const kind3 = row.dwItemKind3 ?? '';
    const bucket = bucketFor(kind1, kind2, kind3);
    if (!bucket) { noBucket++; continue; }

    const name = names.get(row.szName) ?? row.dwID;
    bucket.items.push(rowToItem(row, id, name, kind1, partsMap, dstMap));
    used++;
  }

  const itemsOut = resolve(dataDir, 'items');
  await mkdir(itemsOut, { recursive: true });
  for (const [file, yml] of buckets) {
    await writeFile(resolve(itemsOut, `${file}.yml`), stringify(yml));
  }

  console.log(`  items: ${used} written across ${buckets.size} files, ${dropped} without II_ id, ${noBucket} non-equipment skipped`);
}
