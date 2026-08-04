/**
 * Equip -> combat-stat projection.
 *
 * Reads the equipped slots (`m_Inventory[MAX_INVENTORY + part]`) and folds them
 * into the {@link WeaponStats} + armor-DEF the melee formula consumes. Pure +
 * lazy -- `playerCombatant` calls this every swing, so equip changes take effect
 * immediately with no cache invalidation (rule 05 -- no stat caching).
 *
 * Equip slot indices (PARTS_*): LWEAPON=9, UPPER_BODY=2, LOWER_BODY=3, HAND=4,
 * FOOT=5, CAP=6, SHIELD=11 -- all live at `MAX_INVENTORY + part` in the flat
 * inventory array (`_Common/Item.h:545 CItemContainer::DoEquip`).
 *
 * Element string->enum mapping (`elementFromName`), refine->option decoding, and
 * jewelry HR/ER are all folded in below. atkSpeed uses the item's raw
 * `dwAttackSpeed` (propItem's per-item value -- there is no separate per-type
 * table in C++; the type-specific cadence comes from `job.fAttackSpeed`).
 *
 * @module combat/equipStats
 */

import type { CPlayer } from '@flyff/entities';
import type { ItemDefinition } from '@flyff/resources';
import { MAX_INVENTORY, MAX_HUMAN_PARTS } from '@flyff/world-core';
import { NO_PROP, WT_MELEE_SWD, elementFromName } from './tables';
import type { WeaponStats } from './formulas';

// Weapons live in PARTS_RWEAPON (10) -- `GetActiveHandItemProp( int nParts =
// PARTS_RWEAPON )` (Mover.h:1021) is what every ATK/weapon-type read defaults to,
// and every propItem weapon row carries dwParts=10. PARTS_LWEAPON (9) holds only
// the off-hand of a Blade dual-wield (DoEquip remaps to it, MoverEquip.cpp:515)
// and yoyo models -- reading it as THE weapon slot yields bare hands for
// everyone, zeroing weapon ATK and false-rejecting the bow gate.
const PARTS_RWEAPON = 10;
const PARTS_LWEAPON = 9;
const PARTS_UPPER_BODY = 2; // defender suit element source (MoverAttack.cpp:1249)
const ARMOR_PARTS = new Set([2, 3, 4, 5, 6, 11]); // UPPER_BODY, LOWER_BODY, HAND, FOOT, CAP, SHIELD

export interface EquipStats {
  weapon: WeaponStats;
  /** Summed armor DEF min (propItem dwAbilityMin + refine bonus per piece). */
  armorDef: number;
  /** Summed armor DEF max (propItem dwAbilityMax + refine bonus per piece).
   *  When > armorDef, combat randomizes between the two per hit (C++
   *  GetDefenseByItem(bRandom=TRUE)). Falls back to armorDef when the
   *  resource has no defense_max (older / non-armor items). */
  armorDefMax: number;
  /** Flat hit-rate % from equipped DST_ADJ_HITRATE (jewelry nAdjHitRate). */
  adjHitRate: number;
  /** Evasion from equipped DST_PARRY (jewelry dwParry). */
  parry: number;
  /** Defender suit element (UPPER_BODY m_bItemResist); NO_PROP if none. */
  element: number;
}

/** Item-definition lookup (resources.items.items.get in compose). */
export type ItemLookup = (itemId: number) => ItemDefinition | undefined;

/**
 * Fold equipped gear into weapon stats + armor DEF + HR/ER. Falls back to bare
 * hands + 0 DEF when nothing is equipped (or the resource is missing).
 *
 * Refine bonus = `floor(refine^1.5)` on the raw level (NOT `refine<<4`) -- the
 * wire serializer shifts for the client nibble, but the combat formula wants the
 * decoded level (`GetAbilityOption`, MoverAttack.cpp:2093 / MoverParam.cpp:1948).
 * HR/ER iterate ALL parts (`SumEquipAdjValue`, MoverParam.cpp:1978) -- accessories
 * contribute once their data lands in the item index.
 */
export function sumEquipStats(p: CPlayer, getItem: ItemLookup): EquipStats {
  let weapon: WeaponStats = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
  let armorDef = 0;
  let armorDefMax = 0;
  let adjHitRate = 0;
  let parry = 0;
  let element = NO_PROP;

  // Right hand is the weapon; fall back to the left only for the dual-wield /
  // yoyo case where DoEquip parked the item there.
  const weaponSlot = p.m_Inventory[MAX_INVENTORY + PARTS_RWEAPON]
    ?? p.m_Inventory[MAX_INVENTORY + PARTS_LWEAPON];
  if (weaponSlot) {
    const prop = getItem(weaponSlot.itemId);
    if (prop) {
      weapon = {
        min: prop.attack_min ?? prop.attack ?? 1,
        max: prop.attack_max ?? prop.attack ?? 3,
        type: prop.weapon_type ?? WT_MELEE_SWD,
        atkSpeed: prop.attack_speed ? prop.attack_speed / 100 : 0.4,
        option: weaponSlot.refine ?? 0, // raw level -- formula applies pow(option,1.5)
        // Instance upgrade (m_bItemResist) wins; else the weapon's inherent
        // propItem element (string -> ePropType).
        element: weaponSlot.element ?? elementFromName(prop.element),
      };
    }
  }

  for (let part = 0; part < MAX_HUMAN_PARTS; part++) {
    const slot = p.m_Inventory[MAX_INVENTORY + part];
    if (!slot) continue;
    const prop = getItem(slot.itemId);
    if (!prop) continue;
    if (ARMOR_PARTS.has(part)) {
      const refineBonus = Math.floor(Math.pow(slot.refine ?? 0, 1.5)); // SumEquipDefenseAbility
      armorDef += (prop.defense ?? 0) + refineBonus;
      armorDefMax += (prop.defense_max ?? prop.defense ?? 0) + refineBonus;
    }
    if (prop.hit_rate) adjHitRate += prop.hit_rate;
    if (prop.parry) parry += prop.parry;
  }

  const suit = p.m_Inventory[MAX_INVENTORY + PARTS_UPPER_BODY];
  if (suit) element = suit.element ?? elementFromName(getItem(suit.itemId)?.element);

  return { weapon, armorDef, armorDefMax, adjHitRate, parry, element };
}
