/**
 * @flyff/skills -- skills domain. Skill cast (USESKILL) + learn (DOUSESKILLPOINT)
 * orchestration, the useSkill/doUseSkillPoint handlers, and the useSkill
 * serializer. The shared doUseSkillPoint serializer lives in @flyff/world-core
 * (combat reuses it for level-up SP grant).
 *
 * Depends on `@flyff/{core,entities,world-core,combat,database,resources}`.
 * The skills->combat edge is acyclic (combat does not import skills).
 *
 * @module @flyff/skills
 */

export * from './services/skill.service';
export * from './handlers/useSkill.handler';
export * from './handlers/doUseSkillPoint.handler';
export * from './net/snapshot/useSkill.serializer';
export * from './net/snapshot/doApplyUseSkill.serializer';
