/**
 * @flyff/combat -- combat domain. Damage pipeline (formulas/tables/combatants/
 * equipStats), melee + skill resolution services, monster AI FSM, the melee
 * attack handler, and the combat-owned S->C serializers (damage/death/swing/
 * exp/level/destObj/destPos/setState).
 *
 * Depends on `@flyff/{core,entities,world-core,database,resources}`. The shared
 * `doUseSkillPoint` serializer lives in `@flyff/world-core` (combat + skills both
 * consume it). Shell (world-server) imports this package's handler + service
 * constructors in `compose.ts` / `clientServer.ts`.
 *
 * @module @flyff/combat
 */

export * from './combat/formulas';
export * from './combat/skillFormulas';
export * from './combat/tables';
export * from './combat/combatants';
export * from './combat/equipStats';
export * from './services/combat.service';
export * from './services/meleeAttack.service';
export * from './services/rangeAttack.service';
export * from './services/combat.policy';
export * from './services/duel.service';
export * from './managers/duel.manager';
export * from './systems/ai.system';
export * from './handlers/meleeAttack.handler';
export * from './handlers/rangeAttack.handler';
export * from './handlers/duel.handler';
export * from './net/snapshot/damage.serializer';
export * from './net/snapshot/meleeAttack.serializer';
export * from './net/snapshot/rangeAttack.serializer';
export * from './net/snapshot/setLevel.serializer';
export * from './net/snapshot/destObj.serializer';
export * from './net/snapshot/setState.serializer';
export * from './net/snapshot/setExperience.serializer';
export * from './net/snapshot/moverDeath.serializer';
export * from './net/snapshot/destPos.serializer';
