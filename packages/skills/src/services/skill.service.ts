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
import type { SkillRepository, CharacterRepository, Journal } from '@flyff/database';
import type { CPlayer, CMover, DstEffect, DoTPayload, Vec3 } from '@flyff/entities';
import { isJobMatch, CHG_SENTINEL } from '@flyff/entities';
import type { SpawnManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import type { CombatService } from '@flyff/combat';
import { UseSkillSerializer } from '../net/snapshot/useSkill.serializer';
import { DoApplyUseSkillSerializer } from '../net/snapshot/doApplyUseSkill.serializer';
import { DoUseSkillPointSerializer } from '@flyff/world-core';
import { buildSetPointParam, DST_MP, DST_FP, DST_HP, buildSetSkillState, buildSetDestParam } from '@flyff/world-core';
import { buildEndSkillQueue } from '@flyff/world-core';
import { VISIBILITY_RADIUS, NULL_ID, MAX_SKILL_JOB, MAX_SLOT_QUEUE, SHORTCUT } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'skill-service' });

/** EXT_* cast mechanics supported by the v1 damage path. */
const EXT_MELEEATK = 17;
const EXT_MAGICATKSHOT = 14;
/** `RT_TIME` (defineAttribute.h:236) -- referTarget marks a timed buff skill. */
const RT_TIME = 2;
/** `BUFF_SKILL` (SkillInfluence.h:5) -- skill-sourced buff type tag for SETSKILLSTATE. */
const BUFF_SKILL = 1;

/**
 * `SI_GEN_EVE_*` (resource/defineSkill.h:243-246) -- generic event buff skill
 * ids the NPC buff-pang applies. `SI_ASS_CHEER_*` (defineSkill.h:44-54) are the
 * Assist-class Cheer variants -- strictly stronger, so the C++ NPC-buff path
 * refuses the generic event variant when its Cheer counterpart is active
 * (`DPSrvr.cpp:11268-11275`). Values resolved verbatim from defineSkill.h.
 */
const SI_GEN_EVE_QUICKSTEP = 317;
const SI_GEN_EVE_HASTE = 318;
const SI_GEN_EVE_HEAPUP = 319;
const SI_GEN_EVE_ACCURACY = 320;
const SI_ASS_CHEER_QUICKSTEP = 114;
const SI_ASS_CHEER_HASTE = 20;
const SI_ASS_CHEER_HEAPUP = 49;
const SI_ASS_CHEER_ACCURACY = 116;

/**
 * Generic event buff -> Assist Cheer conflict table
 * (`DPSrvr.cpp:11268-11275`). Key = the NPC-buff eve skill id; value = the
 * Cheer id that, if active, blocks the eve variant (Cheer is strictly stronger).
 */
const NPC_BUFF_CONFLICT: ReadonlyMap<number, number> = new Map([
  [SI_GEN_EVE_QUICKSTEP, SI_ASS_CHEER_QUICKSTEP],
  [SI_GEN_EVE_HASTE, SI_ASS_CHEER_HASTE],
  [SI_GEN_EVE_HEAPUP, SI_ASS_CHEER_HEAPUP],
  [SI_GEN_EVE_ACCURACY, SI_ASS_CHEER_ACCURACY],
]);

/**
 * `SKILLUSETYPE` (`Mover.h:133`) -- how the client triggered the cast. Only the
 * action-slot values matter here: {@link SUT_QUEUESTART} arms the queue (pos 0),
 * {@link SUT_QUEUEING} is the server-driven chain cast for slots 1..4.
 */
const SUT_QUEUESTART = 1;
const SUT_QUEUEING = 2;

/**
 * Minimum gap between queued casts. The C++ server spaces the combo via the
 * per-tick action FSM (`OnActEndMeleeSkill`/`OnActEndMagicSkill` fire when a
 * skill's action completes); we approximate with a timer per step. Too short and
 * the client's `OnCancelSkill` bails on the still-set `REQ_USESKILL` flag
 * (`WndTaskBar.cpp:2420`) leaving `m_nExecute` stuck, which blocks re-triggering
 * the action slot. 700 ms covers an instant-cast swing + flag clear; longer
 * cast bars add their `castingTime` on top (see {@link castDurationMs}).
 */
const QUEUE_ACTION_FLOOR_MS = 700;

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
  /** WAL journal -- crash-safe learn (roster + SP). Optional (tests omit). */
  journal?: Pick<Journal, 'append'>;
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
        | 'stunned'
        | 'flying'
        | 'cooldown'
        | 'no_mp'
        | 'no_fp'
        | 'unsupported'
        | 'invalid_target'
        | 'target_dead'
        | 'target_not_attackable'
        | 'too_far';
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
        | 'insufficient_sp'
        | 'wrong_job';
    };

export class SkillService {
  private readonly useSkill = new UseSkillSerializer();
  private readonly douseSkillPoint = new DoUseSkillPointSerializer();
  private readonly doApplyUseSkill = new DoApplyUseSkillSerializer();

  constructor(private readonly deps: SkillServiceDeps) {}

  /**
   * `DoUseSkill` cast gate (docs #4, gate order). Supports v1 damage skills
   * (EXT_MELEEATK/MAGICATKSHOT) AND heal skills (RT_HEAL → DST_HP restore).
   * On any gate failure the caster is sent CLEAR_USESKILL (cancels its predicted
   * animation) and no MP/FP is spent. On success: spend the resource routed by
   * `resourceType` (KT_MAGIC=1→MP, KT_SKILL=2→FP), set cooldown (SR_AFTER),
   * broadcast USESKILL (incl caster), then apply the effect.
   *
   * ponytail: AoE, multi-hit, projectile, debuff-probability roll (nProbability
   * currently ignored -- debuff always applies on hit).
   */
  cast(player: CPlayer, frame: UseSkillClientFrame): SkillCastOutcome {
    const outcome = this.executeCast(player, frame);
    if (outcome.ok) this.onCastResolved(player, frame);
    return outcome;
  }

  /**
   * Post-cast action-slot hook (port of C++ `OnActEndMeleeSkill` /
   * `OnActEndMagicSkill`, `MoverActEvent.cpp:2056/2073`, which fire when a
   * skill's action completes on the per-tick FSM). `SUT_QUEUESTART` arms the
   * queue (pos 0) and schedules the first advance after skill[0]'s action time
   * -- the chain is spaced one cast per timer tick, not resolved synchronously,
   * so each USESKILL broadcast animates on the client and the terminal
   * `ENDSKILLQUEUE` lands after `REQ_USESKILL` clears (else the client's
   * `OnCancelSkill` bails and `m_nExecute` sticks, blocking re-trigger).
   */
  private onCastResolved(player: CPlayer, frame: UseSkillClientFrame): void {
    if (frame.useType !== SUT_QUEUESTART) return;
    player.m_nUsedSkillQueue = 0;
    this.scheduleQueueStep(player, frame.objid, this.castDurationMs(player, frame.wId));
  }

  /**
   * Approximate skill action duration -- cast bar (`dwCastingTime`) plus the
   * swing/recovery floor. Used only to space queued casts; not a faithful port
   * of the C++ motion-duration action FSM (ponytail).
   */
  private castDurationMs(player: CPlayer, wId: number): number {
    const slot = player.m_aJobSkill[wId];
    const skill = slot && slot.skillId !== NULL_ID ? this.deps.skills.skills.get(slot.skillId) : undefined;
    const levelRow = skill?.levels.find((l) => l.level === slot?.level);
    return Math.max(levelRow?.castingTime ?? 0, QUEUE_ACTION_FLOOR_MS);
  }

  private clearQueueTimer(player: CPlayer): void {
    if (player.m_queueTimer !== undefined) {
      clearTimeout(player.m_queueTimer);
      player.m_queueTimer = undefined;
    }
  }

  /**
   * Schedule the next `advanceQueue` after `delay` ms. Replaces any pending step
   * (a re-trigger or cancel superseded it). The callback self-guards: if the
   * player logged out or the queue was cancelled, it no-ops instead of casting.
   */
  private scheduleQueueStep(player: CPlayer, targetObjid: number, delay: number): void {
    this.clearQueueTimer(player);
    player.m_queueTimer = setTimeout(() => {
      player.m_queueTimer = undefined;
      if (
        player.m_nUsedSkillQueue === -1 ||
        player.m_bDead ||
        this.deps.playerManager.get(player.m_idPlayer) === undefined
      ) {
        return;
      }
      this.advanceQueue(player, targetObjid);
    }, delay);
  }

  /**
   * `CUserTaskBar::SetNextSkill` (`UserTaskBar.cpp:203`). Increments the queue
   * pointer, reads `m_aSlotQueue[pos]`, casts it with `SUT_QUEUEING`, and
   * schedules the next step after its action time. On a failed queued cast the
   * C++ original recurses to skip it (`CMD_SetUseSkill == 0`); we re-schedule
   * with the floor delay. When the queue runs off the end or hits an empty slot,
   * `endQueue` fires the `SNAPSHOTTYPE_ENDSKILLQUEUE` ack so the client clears
   * its action-slot UI.
   *
   * v19 note: the C++ AP-cost table (`UserTaskBar.cpp:211-235`) and the
   * `AddSetActionPoint` send are `#ifndef __NEW_TASKBAR_V19` -- under v19 the
   * client has no `case SNAPSHOTTYPE_SETACTIONPOINT` handler (DPClient.cpp:608),
   * so emitting 0x00c5 hits `default: ASSERT(0)` and desyncs the stream. We
   * never send it; `m_nActionPoint` stays seeded at 100.
   */
  private advanceQueue(player: CPlayer, targetObjid: number): void {
    player.m_nUsedSkillQueue += 1;
    const pos = player.m_nUsedSkillQueue;

    const slot = player.m_aSlotQueue[pos];
    const exhausted =
      pos >= MAX_SLOT_QUEUE ||
      slot === undefined ||
      slot.dwShortcut === SHORTCUT.NONE;
    if (exhausted) {
      this.endQueue(player);
      return;
    }

    const outcome = this.cast(player, { wId: slot.dwId, objid: targetObjid, useType: SUT_QUEUEING });
    if (!outcome.ok) {
      // Queued skill rejected (cooldown, no MP, etc.) -- skip after a brief gap.
      this.scheduleQueueStep(player, targetObjid, QUEUE_ACTION_FLOOR_MS);
      return;
    }
    this.scheduleQueueStep(player, targetObjid, this.castDurationMs(player, slot.dwId));
  }

  /** Queue done -- clear timer, mark inactive, send the bodyless ENDSKILLQUEUE ack. */
  private endQueue(player: CPlayer): void {
    this.clearQueueTimer(player);
    player.m_nUsedSkillQueue = -1;
    this.deps.playerManager.sendTo(player, buildEndSkillQueue(player.m_idPlayer));
  }

  private executeCast(player: CPlayer, frame: UseSkillClientFrame): SkillCastOutcome {
    const slot = player.m_aJobSkill[frame.wId];
    if (slot === undefined) return { ok: false, reason: 'no_skill' };
    if (slot.skillId === NULL_ID || slot.level <= 0) {
      this.clear(player);
      return { ok: false, reason: 'not_learned' };
    }
    if (player.m_bDead) { this.clear(player); return { ok: false, reason: 'dead' }; }
    if (player.isStunned()) { this.clear(player); return { ok: false, reason: 'stunned' }; }
    // C++ `DoUseSkill` returns before the skill loads while airborne
    // (`MoverSkill.cpp:326` `if (m_pActMover->IsFly()) return FALSE`). No skill
    // fires on a board/broom; melee/range are gated separately via combat policy.
    if (player.isFly()) { this.clear(player); return { ok: false, reason: 'flying' }; }

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

    // Resolve target by effect kind -- heal targets a player, damage targets a
    // mover, buff targets a player (buff) OR a mover (debuff). Checked BEFORE the
    // resource spend so a bad target never burns MP/FP (matches C++ DoUseSkill
    // target-before-afford gate order).
    const target = kind === 'heal'
      ? this.resolveHealTarget(player, frame.objid)
      : kind === 'buff'
        ? this.resolveBuffTarget(player, frame.objid)
        : this.resolveDamageTarget(frame.objid);
    if ('reason' in target) { this.clear(player); return target; }

    // Cast-range anti-cheat: C++ `IsRangeObj(pTarget, fRange)` rejects casts
    // beyond the skill's effective range. `skillRange` is in game-world units
    // (same scale as `VISIBILITY_RADIUS`); absent means melee range (2 m).
    const maxRange = levelRow.skillRange ?? 2;
    const targetPos = this.targetPos(frame.objid);
    if (targetPos && distSq3(player.m_vPos, targetPos) > maxRange * maxRange) {
      this.clear(player);
      return { ok: false, reason: 'too_far' };
    }

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

    if ('player' in target) {
      if (kind === 'buff') return this.applyBuffToPlayer(player, target.player, skill, levelRow, now);
      return this.applyHeal(player, target.player, skill, levelRow);
    }
    if ('mover' in target) {
      // Debuff on a monster (e.g. stun/poison/slow) lands in the mover's m_params.
      return this.applyBuffToMover(player, target.mover, skill, levelRow, now);
    }
    // Damage skill (EXT_*ATK). C++ `DoUseSkill` still calls `ApplyParam` when the
    // skill carries a dwDestParam -- so a damage skill with a debuff component
    // (Power Stump = STUN, Sneaker = SLOW) lands BOTH damage AND the debuff on a
    // surviving target. resolveSkill owns damage/death/exp; we tack the debuff on.
    const outcome = this.deps.combatService.resolveSkill(player, frame.objid, skill, levelRow);
    if (outcome.ok && outcome.hit && !outcome.killed && (levelRow.destParams?.length ?? 0) > 0 && outcome.effectProc !== false) {
      const target2 = this.deps.spawnManager.get(frame.objid);
      if (target2 && !target2.m_bDead) this.applyBuffToMover(player, target2, skill, levelRow, now);
    }
    return outcome;
  }

  /**
   * Buff-target resolution: a player (self/other) for beneficial buffs, or a
   * live mover (monster) for debuffs. Self (NULL_ID or own id) is always a
   * player. Mirrors the C++ buff branch where the caster may be the target or
   * a hostile mover depending on the skill's targeting.
   */
  private resolveBuffTarget(
    player: CPlayer,
    objid: number,
  ): { player: CPlayer } | { mover: CMover } | { ok: false; reason: 'invalid_target' | 'target_dead' } {
    if (objid === NULL_ID || objid === player.m_idPlayer) return { player };
    const other = this.deps.playerManager.get(objid);
    if (other !== undefined) {
      if (other.m_bDead) return { ok: false, reason: 'target_dead' };
      return { player: other };
    }
    const mover = this.deps.spawnManager.get(objid);
    if (mover === undefined) return { ok: false, reason: 'invalid_target' };
    if (mover.m_bDead) return { ok: false, reason: 'target_dead' };
    return { mover };
  }

  /** Classify a skill's effect: damage (EXT_*ATK), heal (RT_HEAL), buff (RT_TIME), else unsupported. */
  private effectKind(skill: SkillDefinition): 'heal' | 'damage' | 'buff' | 'unsupported' {
    const ext = skill.exeTarget ?? 0;
    if (ext === EXT_MELEEATK || ext === EXT_MAGICATKSHOT) return 'damage';
    const rt1 = skill.referTargets?.[0] ?? 0;
    const rt2 = skill.referTargets?.[1] ?? 0;
    // RT_HEAL=3 in referTargets marks a heal (docs #4). Heal id 44 has [3,0].
    if (rt1 === 3) return 'heal';
    // RT_TIME=2 on either referTarget marks a timed buff (Ctrl.cpp:1153).
    if (rt1 === RT_TIME || rt2 === RT_TIME) return 'buff';
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
      const before = player.m_nMp;
      player.m_nMp = Math.max(0, before - need.mp);
      logger.info({ charId: player.m_idPlayer, before, cost: need.mp, after: player.m_nMp }, 'spend MP');
      this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_MP, player.m_nMp));
    }
    if (need.fp > 0) {
      const before = player.m_nFp;
      player.m_nFp = Math.max(0, before - need.fp);
      logger.info({ charId: player.m_idPlayer, before, cost: need.fp, after: player.m_nFp }, 'spend FP');
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
   * NPC buff-pang skill application (`OnNPCBuff`, DPSrvr.cpp:11289 -- the
   * `pUser->DoApplySkill(self,self,...)` path). Server-applied: no client cast
   * request, no MP/FP spend, no cooldown. The NPC config supplies the skill id,
   * level, and a duration override (`SetBuffSkill dwSkillTime`, e.g. 3,600,000 ms
   * = one hour) which replaces the per-level `skillTime`.
   *
   * Reuses the same attach + fan-out as {@link applyBuffToPlayer} (BuffManager
   * overwrite rules + SETSKILLSTATE icon + per-DST SETDESTPARAM on add/replace).
   * Two NPC-specific behaviors:
   *  1. **Conflict guard** (DPSrvr.cpp:11268-11275): if the entry is a generic
   *     event buff (`SI_GEN_EVE_*`) whose Assist Cheer counterpart is already
   *     active on the player, refuse it (Cheer is strictly stronger) -- returns
   *     `'conflict'` with no attach.
   *  2. **DOAPPLYUSESKILL** (UserLux.cpp:272) broadcast after any successful
   *     attach so peers + self run the client-local skill animation. The normal
   *     USESKILL cast path does not emit this (it sends USESKILL for the cast bar
   *     instead); the NPC path has no cast bar.
   *
   * `now` is threaded in for testability (shares the service tick's clock).
   */
  applyNpcBuff(
    player: CPlayer,
    skill: SkillDefinition,
    level: SkillLevel,
    durationMs: number,
    now: number,
  ): 'applied' | 'refreshed' | 'replaced' | 'ignored' | 'conflict' {
    const cheerConflict = NPC_BUFF_CONFLICT.get(skill.id);
    if (cheerConflict !== undefined && player.m_buffs.has(cheerConflict)) {
      return 'conflict';
    }
    const effects = buffEffects(level);
    const dot = dotFromSkill(level, now);
    const outcome = player.m_buffs.addSkillBuff(skill.id, level.level, durationMs, effects, now, dot);
    // 'ignored' = a weaker refresh of a stronger active buff (BuffManager kept the
    // stronger). Re-broadcasting SETSKILLSTATE with the weaker level would
    // overwrite the icon's level display, and DOAPPLYUSESKILL would replay the
    // anim for nothing -- so skip both. The existing stronger buff stays visible.
    if (outcome === 'ignored') return 'ignored';
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      buildSetSkillState(player.m_idPlayer, BUFF_SKILL, skill.id, level.level, durationMs),
    );
    if (outcome === 'added' || outcome === 'replaced') {
      for (const e of effects) {
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildSetDestParam(player.m_idPlayer, e.dst, e.adj, e.chg ?? CHG_SENTINEL),
        );
      }
    }
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.doApplyUseSkill.build(player.m_idPlayer, player.m_idPlayer, skill.id, level.level),
    );
    return outcome === 'added' ? 'applied' : outcome;
  }

  /**
   * `ApplyParam` RT_TIME (Ctrl.cpp:1149) -- attach a timed DST buff to the
   * target. Duration is per-level `skillTime` (authoritative; propSkillAdd
   * `dwSkillTime`). Effects built from `destParams`/`adjParamVals`/`chgParamVals`
   * fan into the same `m_params` pool equip DST uses; the {@link BuffManager}
   * owns the expiry lifecycle. Broadcasts SETSKILLSTATE to the vicinity so the
   * client shows the buff icon + timer (the DST delta itself rides SETDESTPARAM,
   * a later slice).
   *
   * The `now` is threaded in (rather than a fresh `Date.now()`) so the cast's
   * cooldown + buff share one timestamp.
   */
  private applyBuffToPlayer(
    caster: CPlayer,
    target: CPlayer,
    skill: SkillDefinition,
    level: SkillLevel,
    now: number,
  ): SkillCastOutcome {
    const effects = buffEffects(level);
    const durationMs = Math.max(0, level.skillTime ?? 0);
    const dot = dotFromSkill(level, now);
    const outcome = target.m_buffs.addSkillBuff(skill.id, level.level, durationMs, effects, now, dot);
    this.deps.zoneManager.broadcastAround(
      target.m_vPos, target.m_nZoneId, VISIBILITY_RADIUS,
      buildSetSkillState(target.m_idPlayer, BUFF_SKILL, skill.id, level.level, durationMs),
    );
    // Sync the DST delta(s) to the client so its stat window updates live. Only
    // on a fresh apply/replace -- on 'refreshed' the effects are already applied
    // (no delta) and on 'ignored' nothing changed.
    if (outcome === 'added' || outcome === 'replaced') {
      for (const e of effects) {
        this.deps.zoneManager.broadcastAround(
          target.m_vPos, target.m_nZoneId, VISIBILITY_RADIUS,
          buildSetDestParam(target.m_idPlayer, e.dst, e.adj, e.chg ?? CHG_SENTINEL),
        );
      }
    }
    // Target only sees the icon + deltas; the caster (if different) is in the
    // vicinity broadcast above. ponytail: RT_TIME stat-scaling bonus (SubReferTime).
    return { ok: true, hit: true, damage: 0, killed: false };
  }

  /**
   * RT_TIME debuff on a monster (`ApplyParam` on a hostile target). Lands the
   * DST effects in the mover's `m_params` -- combat reads them (e.g. a stun bit
   * gates the AI via `isStunned()`, a `-DEF` lowers the damage formula). The
   * {@link BuffManager} owns expiry (swept by `AISystem.tick`). Broadcasts
   * SETSKILLSTATE so peers see the monster debuff icon; no SETDESTPARAM (the
   * client does not track monster DST pools, only the icon).
   */
  private applyBuffToMover(
    caster: CPlayer,
    target: CMover,
    skill: SkillDefinition,
    level: SkillLevel,
    now: number,
  ): SkillCastOutcome {
    const effects = buffEffects(level);
    const durationMs = Math.max(0, level.skillTime ?? 0);
    const dot = dotFromSkill(level, now);
    target.m_buffs.addSkillBuff(skill.id, level.level, durationMs, effects, now, dot);
    this.deps.zoneManager.broadcastAround(
      target.m_vPos, target.m_nZoneId, VISIBILITY_RADIUS,
      buildSetSkillState(target.m_idMover, BUFF_SKILL, skill.id, level.level, durationMs),
    );
    return { ok: true, hit: true, damage: 0, killed: false };
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
      // Job-match gate (C++ IsLearnSkill): the player's job must descend from
      // the skill's JOB_* (dwItemKind2). Closes the anti-cheat gap where any
      // class could learn any skill if SP/reqLevel/prereqs were met.
      if (!isJobMatch(player.m_nJob, skill.job)) return { ok: false, reason: 'wrong_job' };
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

    // Journal the absolute end-state (full roster + SP) BEFORE the fire-and-forget
    // DB persist, so a crash between here and the Knex write replays the learn on
    // next boot (rule 04-persistence: journal critical mutations before ack).
    // Absolute (whole roster, not a delta) => replay is idempotent.
    const roster = player.m_aJobSkill.map((s, slot) => ({ slot, skillId: s.skillId, level: s.level }));
    if (totalCost > 0) {
      this.deps.journal?.append({
        charId: player.m_idPlayer,
        type: 'SKILL_LEARN',
        payload: {
          roster,
          skillPoint: player.m_nSkillPoint,
          skillLevel: player.m_nSkillLevel,
        },
      });
    }
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

  /** Look up target position for cast-range check. Returns null for self-targeted skills. */
  private targetPos(objid: number): Vec3 | null {
    if (objid === NULL_ID) return null;
    const p = this.deps.playerManager.get(objid);
    if (p) return p.m_vPos;
    const m = this.deps.spawnManager.get(objid);
    return m?.m_vPos ?? null;
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

/**
 * Build the DST effect list for a buff skill level from its `destParams`/
 * `adjParamVals`/`chgParamVals` triplets (`MoverActEvent.cpp:205+ ApplyParam`).
 * Skips entries with no `destParam`, and includes a `chg` override only when the
 * per-level value is not the `0x7FFFFFFF` "unused" sentinel.
 */
export function buffEffects(level: SkillLevel): DstEffect[] {
  const dsts = level.destParams ?? [];
  const adjs = level.adjParamVals ?? [];
  const chgs = level.chgParamVals ?? [];
  const effects: DstEffect[] = [];
  for (let i = 0; i < dsts.length; i++) {
    const dst = dsts[i];
    if (!dst) continue;
    const chg = chgs[i];
    effects.push({ dst, adj: adjs[i] ?? 0, ...(chg !== undefined && chg !== CHG_SENTINEL ? { chg } : {}) });
  }
  return effects;
}

/** Default DoT tick interval when the skill carries no `destData` interval. */
const DEFAULT_DOT_INTERVAL_MS = 2_000;

/**
 * Build a periodic-damage payload for a DoT skill level (poison/bleed), or
 * `undefined` if the level has no per-tick damage. C++ sources the tick from
 * `dwCircleTime`/`dwPainTime` (`ProjectCmn.h:140`) and the per-tick damage from
 * `dwAbilityMin`. The converter exposes the interval as `destData[1]` (ms) and
 * the damage as `abilityMin`; a missing interval falls back to 2 s.
 *
 * `nowMs` seeds the first tick (the cast instant), so the first tick lands one
 * interval after cast (mirrors C++ which stamps `tmInst` on apply).
 */
export function dotFromSkill(level: SkillLevel, nowMs: number): DoTPayload | undefined {
  const damage = level.abilityMin ?? 0;
  if (damage <= 0) return undefined;
  const intervalMs = level.destData?.[1] ?? DEFAULT_DOT_INTERVAL_MS;
  return { damage, intervalMs, nextTickMs: nowMs + intervalMs };
}

/** Squared 3D distance — used for cast-range check. */
function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
