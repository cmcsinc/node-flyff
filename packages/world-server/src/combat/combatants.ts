/**
 * Combatant builders — pure projections of {@link CPlayer}/{@link CMover} onto
 * the {@link Combatant} shape the melee formula (`formulas.ts`) consumes.
 *
 * Shared by `CombatService` (player→NPC swings) and `AISystem` (NPC→player
 * swings) so both sides use identical stats. Bare-hand profiles until the
 * equipped-weapon model lands (`combat-plan.md` ponytail).
 *
 * @module combat/combatants
 */

import type { CPlayer } from '../entities/player.js';
import type { CMover } from '../entities/mover.js';
import { NO_PROP, WT_MELEE_SWD } from './tables.js';
import type { Combatant, WeaponStats } from './formulas.js';

/** Bare-hand profile for an unarmed player (ponytail: read equipped weapon). */
export const BARE_HAND: WeaponStats = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

/** Bare-hand stub for NPC (NPCs use raw propMover cols, not the weapon curve). */
export const FIST_NPC: WeaponStats = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

/** Project a live player onto the melee-formula combatant shape. */
export function playerCombatant(p: CPlayer): Combatant {
  return {
    kind: 'player', level: p.m_nLevel, job: p.m_nJob,
    str: p.m_nStr, sta: p.m_nSta, dex: p.m_nDex, int: p.m_nInt,
    weapon: BARE_HAND,
    npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0,
    element: NO_PROP,
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
  };
}
