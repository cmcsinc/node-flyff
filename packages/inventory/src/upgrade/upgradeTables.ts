/**
 * Upgrade / enchant tables for the `PACKETTYPE_ENCHANT` path
 * (`WORLDSERVER/ItemUpgrade.cpp`).
 *
 * Success probabilities are `n/10000` lifted verbatim from
 * `Resource/ItemUpgrade.lua` (the C++ reads them at boot via `CItemUpgrade`).
 * The roll is `xRandom(10000)` -- success when `roll <= nPercent`
 * (`ItemUpgrade.cpp`, `if (xRandom(10000) > nPercent) fail`).
 *
 * Element constants mirror `combat/tables.ts` (both pinned to C++
 * `SAI79::ePropType`, `_Common/data.h:409`). Kept local so `@flyff/inventory`
 * does not grow a `-> @flyff/combat` edge for 6 integers; if they ever diverge
 * the wire (`writeCItemElemBody`) + combat read (`sumEquipStats`) desync, so
 * both must stay aligned.
 *
 * @module upgrade/upgradeTables
 */

// --- SAI79::ePropType (`_Common/data.h:409`) ---
export const NO_PROP = 0;
export const FIRE = 1;
export const WATER = 2;
export const ELECTRICITY = 3;
export const WIND = 4;
export const EARTH = 5;

// --- material dwItemKind3 (propItem `item_kind3`) -> enchant branch ---
/** Sunstone / orichalcum -> weapon + armor refine (`EnchantGeneral`). */
export const IK3_ENCHANT = 'IK3_ENCHANT';
/** Element card -> element attribute (`EnchantAttribute`). */
export const IK3_ELECARD = 'IK3_ELECARD';

// --- target validity (C++ `IsDiceRefineryAble` / `IsEleRefineryAble`) ---
// `Item.cpp:359` (refine): IK2_ARMOR, IK2_ARMORETC, IK2_WEAPON_MAGIC, IK2_WEAPON_DIRECT.
const REFINABLE_IK2 = new Set([
  'IK2_ARMOR',
  'IK2_ARMORETC',
  'IK2_WEAPON_MAGIC',
  'IK2_WEAPON_DIRECT',
]);
// `Item.cpp:374` (element): IK3_SUIT, IK2_WEAPON_MAGIC, IK2_WEAPON_DIRECT.
const ELEMENTABLE_IK3 = new Set(['IK3_SUIT']);
const ELEMENTABLE_IK2 = new Set(['IK2_WEAPON_MAGIC', 'IK2_WEAPON_DIRECT']);

/**
 * Can `target` take a refine level? (C++ `IsDiceRefineryAble`, `Item.cpp:359`.)
 * Weapons + armor only -- accessories, materials, scrolls are rejected.
 */
export function isRefinable(kind2: string | undefined, kind3: string | undefined): boolean {
  if (kind2 && REFINABLE_IK2.has(kind2)) return true;
  return Boolean(kind3 && ELEMENTABLE_IK3.has(kind3));
}

/**
 * Can `target` take an element? (C++ `IsEleRefineryAble`, `Item.cpp:374`.)
 * Suits + weapons only (the suit's element is the defender's resist source in
 * melee, `MoverAttack.cpp:1249`).
 */
export function isElementable(kind2: string | undefined, kind3: string | undefined): boolean {
  if (kind2 && ELEMENTABLE_IK2.has(kind2)) return true;
  return Boolean(kind3 && ELEMENTABLE_IK3.has(kind3));
}

/**
 * Element card item id -> `SAI79::ePropType` (C++ `WhatEleCard`,
 * `ItemUpgrade.cpp:1411`, ids from `defineItem.h:1269-1289`). The card carries
 * its element intrinsically as `eItemType`; our item data drops that column, so
 * resolve by id (stable -- these are the canonical card item ids).
 *
 * ponytail: parse the card's `eItemType` in the resource converter + add an
 * `element` field to the card item definition, then drop this table.
 */
export const CARD_ELEMENT_BY_ID: ReadonlyMap<number, number> = new Map<number, number>([
  [3206, FIRE], // II_GEN_MAT_ELE_FLAME
  [3211, WATER], // II_GEN_MAT_ELE_RIVER
  [3216, ELECTRICITY], // II_GEN_MAT_ELE_GENERATOR
  [3221, EARTH], // II_GEN_MAT_ELE_DESERT
  [3226, WIND], // II_GEN_MAT_ELE_CYCLON
]);

/**
 * General weapon/armor refine probability (Lua `tGeneral`). Indexed by the
 * CURRENT refine level -- value is the chance to reach `current + 1`.
 * Non-KOR clients take `× 0.9` from +3 onward (`ItemUpgrade.cpp:1125`).
 */
export const REFINE_PROB: readonly number[] = Object.freeze([
  10000, 10000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 500,
]);
/** Max refine level = table length (`m_mapGeneralEnchant.size()`, +10). */
export const MAX_REFINE = REFINE_PROB.length;

/**
 * Element attribute probability (Lua `tAttribute`). Indexed by the CURRENT
 * element level -- value is the chance to reach `current + 1`. Max +20.
 */
export const ELEMENT_PROB: readonly number[] = Object.freeze([
  10000, 10000, 9200, 8000, 6300, 5000, 4000, 3300, 2700, 2300,
  2000, 1400, 1200, 900, 800, 750, 700, 550, 520, 500,
]);
/** Max element level = table length (`m_mapAttributeEnchant.size()`, +20). */
export const MAX_ELEMENT = ELEMENT_PROB.length;

/** Above this refine/element level, a failure destroys the item (`ItemUpgrade.cpp:1071`). */
export const DESTROY_THRESHOLD = 3;

/** Non-KOR probability multiplier applied to refine rolls at +3+ (`ItemUpgrade.cpp:1125`). */
const NON_KOR_FACTOR = 0.9;

/**
 * Success chance for a refine roll at `currentLevel` (n/10000). Returns 0 when
 * already at max. Applies the non-KOR `×0.9` factor from +3 onward.
 */
export function refineChance(currentLevel: number): number {
  if (currentLevel >= MAX_REFINE) return 0;
  const base = REFINE_PROB[currentLevel] ?? 0;
  return currentLevel >= DESTROY_THRESHOLD ? Math.round(base * NON_KOR_FACTOR) : base;
}

/** Success chance for an element roll at `currentLevel` (n/10000). 0 at max. */
export function elementChance(currentLevel: number): number {
  if (currentLevel >= MAX_ELEMENT) return 0;
  return ELEMENT_PROB[currentLevel] ?? 0;
}
