/**
 * Combatant builders -- pure projections of {@link CPlayer}/{@link CMover} onto
 * the {@link Combatant} shape the melee formula (`formulas.ts`) consumes.
 *
 * Shared by `CombatService` (player->NPC swings) and `AISystem` (NPC->player
 * swings) so both sides use identical stats. Bare-hand profiles until the
 * equipped-weapon model lands (`combat-plan.md` ponytail).
 *
 * @module combat/combatants
 */

import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';
import { NO_PROP, WT_MELEE_SWD } from './tables';
import type { Combatant, WeaponStats } from './formulas';
import { sumEquipStats, type ItemLookup } from './equipStats';

/** Bare-hand profile for an unarmed player. */
export const BARE_HAND: WeaponStats = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

/** Bare-hand stub for NPC (NPCs use raw propMover cols, not the weapon curve). */
export const FIST_NPC: WeaponStats = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

/** No-gear equip fold (NPC->player path lacks resource access -- ponytail). */
const BARE_EQUIP = { weapon: BARE_HAND, armorDef: 0, armorDefMax: 0, adjHitRate: 0, parry: 0, element: NO_PROP };

/**
 * Project a live player onto the melee-formula combatant shape. When `getItem`
 * is supplied, equipped weapon/armor/jewelry fold in via `sumEquipStats`;
 * otherwise bare hands + 0 DEF.
 */
export function playerCombatant(p: CPlayer, getItem?: ItemLookup, partyCritBonus?: number): Combatant {
  const eq = getItem ? sumEquipStats(p, getItem) : BARE_EQUIP;
  return {
    kind: 'player', level: p.m_nLevel, job: p.m_nJob,
    // Primary stats include equip + DST buffs (C++ GetStr/Sta/Dex/Int = m_nX +
    // GetParam(DST_X)) so a +STR ring raises damage/DEF the moment it's equipped.
    str: p.getStr(), sta: p.getSta(), dex: p.getDex(), int: p.getInt(),
    weapon: eq.weapon,
    npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0,
    element: eq.element,
    equipDef: eq.armorDef,
    equipDefMax: eq.armorDefMax,
    adjHitRate: eq.adjHitRate,
    parry: eq.parry,
    params: p.m_params,
    // One-shot party SphereCircle crit bonus, already consumed by the caller.
    partyCritBonus,
  };
}

/** Project a live mover onto the melee-formula combatant shape. */
export function moverCombatant(m: CMover): Combatant {
  return {
    kind: 'npc', level: m.m_nLevel, job: 0,
    str: 0, sta: 0, dex: 0, int: 0,
    weapon: FIST_NPC,
    npcAtkMin: m.m_nAtkMin, npcAtkMax: m.m_nAtkMax, npcArmor: m.m_nArmor,
    npcResisMagic: 0, npcHR: m.m_nHR, npcER: m.m_nER, element: m.m_nElement,
    equipDef: 0, equipDefMax: 0, adjHitRate: 0, parry: 0,
    params: m.m_params,
    // Defender-side knock-up gate inputs (`CanFlyByAttack`).
    rank: m.m_dwClass,
    flyable: m.m_bFlyable,
  };
}
