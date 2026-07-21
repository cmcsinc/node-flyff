/**
 * Equip → combat-stat projection.
 *
 * Reads the equipped slots (`m_Inventory[MAX_INVENTORY + part]`) and folds them
 * into the {@link WeaponStats} + armor-DEF the melee formula consumes. Pure +
 * lazy — `playerCombatant` calls this every swing, so equip changes take effect
 * immediately with no cache invalidation (rule 05 — no stat caching).
 *
 * Equip slot indices (PARTS_*): LWEAPON=9, UPPER_BODY=2, LOWER_BODY=3, HAND=4,
 * FOOT=5, CAP=6, SHIELD=11 — all live at `MAX_INVENTORY + part` in the flat
 * inventory array (`_Common/Item.h:545 CItemContainer::DoEquip`).
 *
 * ponytail: element string→enum mapping (items carry `element` as a string; the
 * formula wants the numeric NO_PROP/ELEMENT_*); refine→option encoding; jewelry
 * HR/ER; atkSpeed table is per-weapon-type (uses raw dwAttackSpeed for now).
 *
 * @module combat/equipStats
 */

import type { CPlayer } from '../entities/player.js';
import type { ItemDefinition } from '@flyff/resources';
import { MAX_INVENTORY } from '../net/snapshot/constants.js';
import { NO_PROP, WT_MELEE_SWD } from './tables.js';
import type { WeaponStats } from './formulas.js';

const PARTS_LWEAPON = 9;
const ARMOR_PARTS = [2, 3, 4, 5, 6, 11]; // UPPER_BODY, LOWER_BODY, HAND, FOOT, CAP, SHIELD

export interface EquipStats {
  weapon: WeaponStats;
  armorDef: number;
}

/** Item-definition lookup (resources.items.items.get in compose). */
export type ItemLookup = (itemId: number) => ItemDefinition | undefined;

/**
 * Fold equipped gear into weapon stats + armor DEF. Falls back to bare hands +
 * 0 DEF when nothing is equipped (or the resource is missing).
 */
export function sumEquipStats(p: CPlayer, getItem: ItemLookup): EquipStats {
  let weapon: WeaponStats = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
  let armorDef = 0;

  const weaponSlot = p.m_Inventory[MAX_INVENTORY + PARTS_LWEAPON];
  if (weaponSlot) {
    const prop = getItem(weaponSlot.itemId);
    if (prop) {
      weapon = {
        min: prop.attack_min ?? prop.attack ?? 1,
        max: prop.attack_max ?? prop.attack ?? 3,
        type: prop.weapon_type ?? WT_MELEE_SWD,
        atkSpeed: prop.attack_speed ? prop.attack_speed / 100 : 0.4,
        option: (weaponSlot.refine ?? 0) << 4,
        element: NO_PROP, // ponytail: prop.element string → numeric ELEMENT_*
      };
    }
  }

  for (const part of ARMOR_PARTS) {
    const slot = p.m_Inventory[MAX_INVENTORY + part];
    if (!slot) continue;
    const prop = getItem(slot.itemId);
    if (prop) armorDef += prop.defense ?? 0;
  }

  return { weapon, armorDef };
}
