/**
 * SkillService -- `USESKILL` (cast) + `DOUSESKILLPOINT` (learn) orchestration.
 *
 * v1 MVP scope (docs `skills-research.md` #6): single-target **damage** skills
 * only (EXT_MELEEATK=17, EXT_MAGICATKSHOT=14). Cast runs the
 * `skillFormulas.resolveSkillCast` damage chain via `CombatService.resolveSkill`
 * (reuses the melee DAMAGE/ death/ exp/ rage tail). Learn validates the proposed
 * roster server-side (close the C++ anti-cheat gap: reqLevel + maxLevel +
 * prereqs + no-decrease + tier cost), spends SP, persists fire-and-forget.
 *
 * ponytail: heal/buff/AoE/multi-hit, MAGIC_ATTACK/RANGE_ATTACK auto-attack,
 * skill crit (`nProbability`), job-match gate on learn, WAL `SKILL_LEARN`
 * journal type + replayer, MP/FP regen.
 *
 * @module services/skill
 */

import type { SkillIndex, SkillDefinition, SkillLevel } from '@flyff/resources';
import type { SkillRepository, CharacterRepository } from '@flyff/database';
import type { CPlayer } from '@flyff/entities';
import type { SpawnManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import type { CombatService } from './combat.service';
import { UseSkillSerializer } from '../net/snapshot/useSkill.serializer';
import { DoUseSkillPointSerializer } from '../net/snapshot/doUseSkillPoint.serializer';
import { buildSetPointParam, DST_MP, DST_FP, DST_HP } from '../net/snapshot/pointParam.serializer';
import { VISIBILITY_RADIUS, NULL_ID, MAX_SKILL_JOB } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'skill-service' });

/** EXT_* cast mechanics supported by the v1 damage path. */
const EXT_MELEEATK = 17;
const EXT_MAGICATKSHOT = 14;

/**
 * Per-tier SP cost per raised skill level (`Project.cpp:5132`).
 * JTYPE tier -> cost: vagrant(BASE)=1, expert=2, pro/master/hero=3.
 */
const TIER_SP_COST: ReadonlyMap<number, number> = new Map([
  [0, 1], // BASE (vagrant)
  [1, 2], // EXPERT
  [2, 3], // PRO
  [4, 3], // COMMON
  [5, 3], // MASTER
  [6, 3], // HERO
]);

export interface SkillServiceDeps {
  skills: SkillIndex;
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
  playerManager: PlayerManager;
  combatService: CombatService;
  skillRepo: Pick<SkillRepository, 'saveAll'>;
  charRepo: Pick<CharacterRepository, 'updateSkillPoints'>;
}

/** Client USESKILL frame after the dispatcher strips wType + bControl. */
export interface UseSkillClientFrame {
  /** Slot index 0..44 (the client's `wId`). */
  wId: number;
  /** Target objid. */
  objid: number;
  /** SUT_* use type (0 instant, 1 charge, 2 control). */
  useType: number;
}

export type SkillCastOutcome =
  | { ok: true; hit: boolean; damage: number; killed: boolean }
  | {
      ok: false;
      reason:
        | 'no_skill'
        | 'not_learned'
        | 'unknown_skill'
        | 'dead'
        | 'cooldown'
        | 'no_mp'
        | 'no_fp'
        | 'unsupported'
        | 'invalid_target'
        | 'target_dead'
        | 'target_not_attackable';
    };

export type LearnOutcome =
  | { ok: true; spent: number; skillPoint: number }
  | {
      ok: false;
      reason:
        | 'unknown_skill'
        | 'decrease'
        | 'slot_occupied'
        | 'over_max'
        | 'low_level'
        | 'prereq'
        | 'insufficient_sp';
    };

export class SkillService {
  private readonly useSkill = new UseSkillSerializer();
  private readonly douseSkillPoint = new DoUseSkillPointSerializer();

  constructor(private readonly deps: SkillServiceDeps) {}

  /**
   * `DoUseSkill` cast gate (docs #4, gate order). Supports v1 damage skills
   * (EXT_MELEEATK/MAGICATKSHOT) AND heal skills (RT_HEAL → DST_HP restore).
   * On any gate failure the caster is sent CLEAR_USESKILL (cancels its predicted
   * animation) and no MP/FP is spent. On success: spend the resource routed by
   * `resourceType` (KT_MAGIC=1→MP, KT_SKILL=2→FP), set cooldown (SR_AFTER),
   * broadcast USESKILL (incl caster), then apply the effect.
   *
   * ponytail: buffs (dwDestParam=0 across all v15 skills -- C++ per-id special
   * case, not data-driven), AoE, multi-hit, projectile.
   */
  cast(player: CPlayer, frame: UseSkillClientFrame): SkillCastOutcome {
    const slot = player.m_aJobSkill[frame.wId];
    if (slot === undefined) return { ok: false, reason: 'no_skill' };
    if (slot.skillId === NULL_ID || slot.level <= 0) {
      this.clear(player);
      return { ok: false, reason: 'not_learned' };
    }
    if (player.m_bDead) { this.clear(player); return { ok: false, reason: 'dead' }; }

    const skill = this.deps.skills.skills.get(slot.skillId);
    if (skill === undefined) { this.clear(player); return { ok: false, reason: 'unknown_skill' }; }
    const levelRow = skill.levels.find((l) => l.level === slot.level);
    if (levelRow === undefined) { this.clear(player); return { ok: false, reason: 'unknown_skill' }; }

    const kind = this.effectKind(skill);
    if (kind === 'unsupported') { this.clear(player); return { ok: false, reason: 'unsupported' }; }

    const now = Date.now();
    if ((player.m_tmReUseDelay[frame.wId] ?? 0) > now) {
      this.clear(player);
      return { ok: false, reason: 'cooldown' };
    }

    // Resolve target by effect kind -- heal targets a player (self/other), damage
    // targets a mover. Checked BEFORE the resource spend so a bad target never
    // burns MP/FP (matches C++ DoUseSkill target-before-afford gate order).
    const target = kind === 'heal'
      ? this.resolveHealTarget(player, frame.objid)
      : this.resolveDamageTarget(frame.objid);
    if ('reason' in target) { this.clear(player); return target; }

    // Resource need is routed by KT (resourceType): magic=MP, skill=FP. The data
    // carries a nonzero "other" cost on some skills (e.g. Heal reqFp:83) that is
    // NOT consumed -- gating both would wrongly block MP skills.
    const need = this.resourceNeed(skill, levelRow);
    if (need.mp > 0 && player.m_nMp < need.mp) { this.clear(player); return { ok: false, reason: 'no_mp' }; }
    if (need.fp > 0 && player.m_nFp < need.fp) { this.clear(player); return { ok: false, reason: 'no_fp' }; }

    this.spendResource(player, need);
    const cd = levelRow.cooldown ?? skill.baseCooldown ?? 0;
    if (cd > 0) player.m_tmReUseDelay[frame.wId] = now + cd;

    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.useSkill.build(player.m_idPlayer, {
        skillId: slot.skillId, level: slot.level, target: frame.objid,
        useType: frame.useType, castingTime: levelRow.castingTime ?? 0,
      }),
    );

    return 'player' in target
      ? this.applyHeal(player, target.player, skill, levelRow)
      : this.deps.combatService.resolveSkill(player, frame.objid, skill, levelRow);
  }

  /** Classify a skill's effect: damage (EXT_*ATK), heal (RT_HEAL), or unsupported. */
  private effectKind(skill: SkillDefinition): 'heal' | 'damage' | 'unsupported' {
    const ext = skill.exeTarget ?? 0;
    if (ext === EXT_MELEEATK || ext === EXT_MAGICATKSHOT) return 'damage';
    // RT_HEAL=3 in referTargets marks a heal (docs #4). Heal id 44 has [3,0].
    const rt = skill.referTargets?.[0] ?? 0;
    if (rt === 3) return 'heal';
    return 'unsupported';
  }

  /** MP/FP need routed by `resourceType` (KT_MAGIC=1→MP, else FP). */
  private resourceNeed(skill: SkillDefinition, level: SkillLevel): { mp: number; fp: number } {
    if (skill.resourceType === 1) return { mp: Math.max(0, level.reqMp ?? 0), fp: 0 };
    return { mp: 0, fp: Math.max(0, level.reqFp ?? 0) };
  }

  /** Spend the routed resource (clamp >= 0) + sync the client. */
  private spendResource(player: CPlayer, need: { mp: number; fp: number }): void {
    if (need.mp > 0) {
      player.m_nMp = Math.max(0, player.m_nMp - need.mp);
      this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_MP, player.m_nMp));
    }
    if (need.fp > 0) {
      player.m_nFp = Math.max(0, player.m_nFp - need.fp);
      this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_FP, player.m_nFp));
    }
  }

  /**
   * Heal target: self (objid NULL_ID or self), or another live player by charId.
   * NPC heals are ponytail (NPCs don't need healing).
   */
  private resolveHealTarget(
    player: CPlayer,
    objid: number,
  ): { player: CPlayer } | { ok: false; reason: 'invalid_target' | 'target_dead' } {
    if (objid === NULL_ID || objid === player.m_idPlayer) return { player };
    const other = this.deps.playerManager.get(objid);
    if (other === undefined) return { ok: false, reason: 'invalid_target' };
    if (other.m_bDead) return { ok: false, reason: 'target_dead' };
    return { player: other };
  }

  /** Damage target: a live mover in the spawn table (full attackable check in resolveSkill). */
  private resolveDamageTarget(
    objid: number,
  ): { objid: number } | { ok: false; reason: 'invalid_target' | 'target_dead' } {
    const mover = this.deps.spawnManager.get(objid);
    if (mover === undefined) return { ok: false, reason: 'invalid_target' };
    if (mover.m_bDead) return { ok: false, reason: 'target_dead' };
    return { objid };
  }

  /**
   * `ApplyParam` RT_HEAL (docs #4): `nIncHP = adjParamVal1 + (referValue/10)*stat
   * + skillLvl*(stat/50)`, stat = the caster's first referStat (DST_INT for Heal).
   * Clamp to maxHp, sync the target (+ caster if other).
   */
  private applyHeal(caster: CPlayer, target: CPlayer, skill: SkillDefinition, level: SkillLevel): SkillCastOutcome {
    const inc = this.healAmount(caster, skill, level);
    target.m_nHp = Math.min(target.m_nMaxHp, target.m_nHp + inc);
    target._dirty.add('m_nHp');
    this.deps.playerManager.sendTo(target, buildSetPointParam(target.m_idPlayer, DST_HP, target.m_nHp));
    if (target !== caster) {
      // Caster sees the heal land on its target (HP bar of the healed mover).
      this.deps.playerManager.sendTo(caster, buildSetPointParam(target.m_idPlayer, DST_HP, target.m_nHp));
    }
    return { ok: true, hit: true, damage: 0, killed: false };
  }

  /** RT_HEAL restore amount (floor per term, matching the C++ integer math). */
  private healAmount(caster: CPlayer, skill: SkillDefinition, level: SkillLevel): number {
    const stat = statForDst(caster, skill.referStats?.[0] ?? 0);
    const refVal = skill.referValues?.[0] ?? 0;
    const adj = level.adjParamVals?.[0] ?? 0;
    const skillLvl = level.level ?? 1;
    return adj + Math.floor(refVal / 10) * stat + skillLvl * Math.floor(stat / 50);
  }

  /**
   * `OnDoUseSkillPoint` learn (docs #5). The client proposes its full 45-slot
   * roster; the server validates atomically (any reject -> whole batch rejected,
   * no SP spent, no confirm). Server-side gates beyond C++ (which trusts the
   * client): maxLevel, reqLevel, prereqs, no-decrease, no slot reassignment.
   * Cost = `Σ (newLevel - curLevel) * tierCost` per raised slot.
   */
  learnSkills(
    player: CPlayer,
    requested: ReadonlyArray<{ skillId: number; level: number }>,
  ): LearnOutcome {
    let totalCost = 0;
    const apply: Array<{ slot: number; skillId: number; level: number }> = [];

    for (let i = 0; i < MAX_SKILL_JOB; i++) {
      const req = requested[i];
      const cur = player.m_aJobSkill[i] ?? { skillId: NULL_ID, level: 0 };
      if (req === undefined || req.skillId === NULL_ID || req.skillId === 0 || req.level <= 0) continue;
      const skill = this.deps.skills.skills.get(req.skillId);
      if (skill === undefined) return { ok: false, reason: 'unknown_skill' };
      if (cur.skillId !== NULL_ID && cur.skillId !== req.skillId) {
        return { ok: false, reason: 'slot_occupied' };
      }
      if (cur.skillId === req.skillId && req.level < cur.level) {
        return { ok: false, reason: 'decrease' };
      }
      if (req.level > (skill.maxLevel ?? 1)) return { ok: false, reason: 'over_max' };
      if (skill.reqLevel > 0 && player.m_nLevel < skill.reqLevel) {
        return { ok: false, reason: 'low_level' };
      }
      for (const p of skill.prereqs) {
        const met = player.m_aJobSkill.some((s) => s.skillId === p.skill && s.level >= p.level);
        if (!met) return { ok: false, reason: 'prereq' };
      }
      const curLevel = cur.skillId === req.skillId ? cur.level : 0;
      const tierCost = TIER_SP_COST.get(skill.tier) ?? 3;
      totalCost += (req.level - curLevel) * tierCost;
      apply.push({ slot: i, skillId: req.skillId, level: req.level });
    }

    if (totalCost > player.m_nSkillPoint) return { ok: false, reason: 'insufficient_sp' };

    for (const a of apply) {
      player.m_aJobSkill[a.slot] = { skillId: a.skillId, level: a.level };
    }
    if (totalCost > 0) {
      player.m_nSkillPoint -= totalCost;
      player._dirty.add('m_aJobSkill');
      player._dirty.add('m_nSkillPoint');
    }

    // Persist roster + SP fire-and-forget. ponytail: WAL SKILL_LEARN + replayer.
    const roster = player.m_aJobSkill.map((s, slot) => ({ slot, skillId: s.skillId, level: s.level }));
    this.deps.skillRepo.saveAll(player.m_idPlayer, roster).catch(
      (err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'skill roster persist failed'),
    );
    this.deps.charRepo.updateSkillPoints(player.m_idPlayer, player.m_nSkillPoint, player.m_nSkillLevel).catch(
      (err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'skill-point persist failed'),
    );

    this.deps.playerManager.sendTo(
      player,
      this.douseSkillPoint.build(player.m_idPlayer, player.m_aJobSkill, player.m_nSkillPoint),
    );
    return { ok: true, spent: totalCost, skillPoint: player.m_nSkillPoint };
  }

  /** Send CLEAR_USESKILL to the caster (cast rejected). */
  private clear(player: CPlayer): void {
    this.deps.playerManager.sendTo(player, this.useSkill.buildClear(player.m_idPlayer));
  }
}

/**
 * Resolve a `DST_*` referStat (1=STR, 2=DEX, 3=INT, 4=STA) to the caster's stat.
 * Used by the heal formula's `(referValue/10)*stat` term. Other DST default to 0.
 */
function statForDst(player: CPlayer, dst: number): number {
  switch (dst) {
    case 1: return player.m_nStr;
    case 2: return player.m_nDex;
    case 3: return player.m_nInt;
    case 4: return player.m_nSta;
    default: return 0;
  }
}
