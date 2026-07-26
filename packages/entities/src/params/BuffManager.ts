/**
 * Timed DST buff lifecycle layer -- port of the C++ `CBuffMgr` (`__BUFF_1107`)
 * over the same `m_adjParamAry`/`m_chgParamAry` pool {@link ParamModel} exposes.
 *
 * Where `ParamModel` is the *state* (the additive/override arrays every DST
 * source -- equip, buff, item -- converges on), `BuffManager` is the
 * *lifecycle*: it owns the active timed buffs, applies their DST effects on add
 * (via `m_params.applyEffects`) and reverses them on expire/remove (via
 * `removeEffects`), and runs the per-second expiry sweep.
 *
 * ## C++ mechanics ported (`_Common/buff.cpp`)
 *
 * - **Container**: keyed by skill id (one active slot per skill), soft cap
 *   `MAX_SKILL_BUFF = 28` (`SkillInfluence.h:11`). Over cap, the oldest entry is
 *   evicted. ponytail: C++ `PrepareBS` evicts the first *beneficial* buff
 *   (`nEvildoing >= 0`) rather than the oldest -- upgrade when `nEvildoing`
 *   lands in the skill schema.
 * - **Overwrite** (`CBuffMgr::Overwrite` + `AddTotal`, `buff.cpp:662-678,723`):
 *   re-casting an active skill buff does NOT stack. Same level → refresh to
 *   `max(remaining, new duration)` (effects already applied, no re-apply).
 *   Lower level → replace (remove old, add new). Higher level → ignore.
 * - **Expiry** (`IBuff::Timeover`, `buff.cpp:161`): `now - inst >= total`.
 *   Driven by a 1-second tick (`CMover::ProcessBuff`, `Mover.cpp:3880`).
 *
 * Pure data -- no socket/packet deps. Callers (skill.service, the world tick)
 * own the S→C snapshot broadcasts; {@link tick} / {@link remove} / {@link clear}
 * return the affected buffs so the caller can emit `REMOVESKILLINFULENCE`.
 *
 * @module entities/params/BuffManager
 */

import type { DstEffect, ParamModel } from './ParamModel';

/** `BUFF_ITEM` (SkillInfluence.h:4) -- consumable-item-sourced buff type tag. */
export const BUFF_ITEM = 0;
/** C++ `BUFF_SKILL` (`SkillInfluence.h:5`). */
export const BUFF_SKILL = 1;

/** `MAX_SKILLBUFF_COUNT` (`SkillInfluence.h:11`) -- soft cap on active skill buffs. */
export const MAX_SKILL_BUFF = 28;

/** One active timed DST buff, mirroring `IBuff` (`_Common/buff.h:88-98`). */
export interface ActiveBuff {
  /** Skill id (the `wId` on `CBuffSkill`). */
  readonly skillId: number;
  /** Skill level (`dwLevel`). */
  readonly level: number;
  /** Buff source type (`BUFF_SKILL` ...). */
  readonly type: number;
  /** Absolute expiry timestamp (ms). C++ stores inst+total; we store the deadline. */
  expiresAtMs: number;
  /**
   * Originally-applied TOTAL duration in ms (C++ `IBuff::GetTotal`). Persisted
   * to `characters.buffs` and used to re-apply the buff at full duration on
   * relog (`SaveSkillInfluence` / `GetSKillInfluence` store total, not
   * remaining, so the timer resets to full on JOIN).
   */
  totalMs: number;
  /** DST effects applied for this buff -- reversed verbatim on remove/expire. */
  readonly effects: readonly DstEffect[];
  /** Optional periodic-damage payload (poison/bleed). Absent on non-DoT buffs. */
  readonly dot?: DoTPayload;
}

/**
 * Periodic (DoT) damage payload for a poison/bleed-style buff. C++ drives this
 * off `dwCircleTime` / `dwPainTime` (ProjectCmn.h:140) -- a tick interval in ms.
 * Each tick applies `damage` and stamps `nextTickMs`. A non-DoT buff has no dot.
 */
export interface DoTPayload {
  /** Flat damage applied each tick (C++ `dwAbilityMin` for the DoT skill). */
  readonly damage: number;
  /** Tick interval in ms (C++ `dwCircleTime` / `dwPainTime`). */
  intervalMs: number;
  /** Absolute timestamp of the next tick. */
  nextTickMs: number;
}

/** Outcome of {@link BuffManager.addSkillBuff} (mirrors C++ overwrite dispatch). */
export type AddBuffOutcome = 'added' | 'refreshed' | 'replaced' | 'ignored';

export class BuffManager {
  /** Keyed by skill id; insertion order preserved (used for cap eviction). */
  private readonly buffs = new Map<number, ActiveBuff>();
  private readonly params: ParamModel;

  constructor(params: ParamModel) {
    this.params = params;
  }

  /** Number of active buffs. */
  get size(): number {
    return this.buffs.size;
  }

  /** True iff a buff from `skillId` is currently active. */
  has(skillId: number): boolean {
    return this.buffs.has(skillId);
  }

  /**
   * All active buffs in insertion order. Used by the checkpoint flush to
   * persist `characters.buffs` and by the JOIN handler to re-broadcast
   * SETSKILLSTATE + SETDESTPARAM for restored buffs (self-only).
   */
  getAll(): readonly ActiveBuff[] {
    return [...this.buffs.values()];
  }

  /**
   * Attach a timed skill buff (`CBuffMgr::AddBuff` + `Overwrite`).
   *
   * - Same skill, same level → refresh duration to `max(remaining, new)`. Effects
   *   already applied; no re-apply.
   * - Same skill, lower level → replace (reset old effects, apply new).
   * - Same skill, higher level → ignore the new cast.
   * - New skill → if at cap, evict the oldest, then apply.
   *
   * @returns the overwrite outcome so the caller can decide the snapshot.
   */
  addSkillBuff(
    skillId: number,
    level: number,
    durationMs: number,
    effects: readonly DstEffect[],
    nowMs: number,
    dot?: DoTPayload,
  ): AddBuffOutcome {
    const existing = this.buffs.get(skillId);
    if (existing !== undefined) {
      if (level === existing.level) {
        // AddTotal: max(remaining, new). No re-apply (effects already in the pool).
        const deadline = nowMs + durationMs;
        existing.expiresAtMs = existing.expiresAtMs > deadline ? existing.expiresAtMs : deadline;
        existing.totalMs = durationMs;
        return 'refreshed';
      }
      if (level < existing.level) {
        return 'ignored'; // a weaker refresh of a stronger active buff
      }
      // Higher level: drop the old, fall through to a fresh add.
      this.detach(existing);
    } else if (this.buffs.size >= MAX_SKILL_BUFF) {
      // Cap -- evict the oldest (first inserted). See ponytail in file header.
      const oldest = this.buffs.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.buffs.get(oldest);
        if (evicted) this.detach(evicted);
      }
    }
    this.params.applyEffects(effects);
    this.buffs.set(skillId, { skillId, level, type: BUFF_SKILL, expiresAtMs: nowMs + durationMs, totalMs: durationMs, effects, dot });
    return existing !== undefined ? 'replaced' : 'added';
  }

  /**
   * Attach a timed item buff (CBuffItem, `BUFF_ITEM`). Simple re-cast: same
   * item refreshes duration to `max(remaining, new)` without re-apply; different
   * items stack additively (the map is keyed by skillId only, so two distinct
   * items naturally coexist).
   *
   * ponytail: item buff levels for stacking-overwrite parity with C++ CBuffItem.
   */
  addItemBuff(
    itemId: number,
    durationMs: number,
    effects: readonly DstEffect[],
    nowMs: number,
  ): AddBuffOutcome {
    const existing = this.buffs.get(itemId);
    if (existing !== undefined) {
      const deadline = nowMs + durationMs;
      existing.expiresAtMs = existing.expiresAtMs > deadline ? existing.expiresAtMs : deadline;
      existing.totalMs = durationMs;
      return 'refreshed';
    }
    if (this.buffs.size >= MAX_SKILL_BUFF) {
      const oldest = this.buffs.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.buffs.get(oldest);
        if (evicted) this.detach(evicted);
      }
    }
    this.params.applyEffects(effects);
    this.buffs.set(itemId, { skillId: itemId, level: 0, type: BUFF_ITEM, expiresAtMs: nowMs + durationMs, totalMs: durationMs, effects });
    return 'added';
  }

  /**
   * Remove a buff by skill id (`CBuffMgr::RemoveBuff`). Reverses its effects.
   * @returns the removed buff, or `undefined` if it was not active.
   */
  remove(skillId: number): ActiveBuff | undefined {
    const buff = this.buffs.get(skillId);
    if (buff === undefined) return undefined;
    this.detach(buff);
    return buff;
  }

  /**
   * Per-second expiry sweep (`CBuffMgr::Process`, `buff.cpp:811`).
   * Reverses + drops every buff whose deadline has passed.
   * @returns the expired buffs so the caller can broadcast removal snapshots.
   */
  tick(nowMs: number): ActiveBuff[] {
    const expired: ActiveBuff[] = [];
    for (const buff of this.buffs.values()) {
      if (nowMs >= buff.expiresAtMs) expired.push(buff);
    }
    for (const buff of expired) this.detach(buff);
    return expired;
  }

  /**
   * Periodic-damage sweep for DoT buffs (poison/bleed). Returns each due buff
   * with the damage to apply, and advances its `nextTickMs` cursor by its
   * interval. Pure data -- the caller (BuffSystem/AISystem) applies the HP loss,
   * clamps, and handles death; this returns the events without touching HP.
   *
   * A buff that expired this same tick is still DoT'd once if its deadline is
   * past (final-tick damage) before {@link tick} removes it -- callers should
   * run `tickDots` before `tick`.
   */
  tickDots(nowMs: number): Array<{ buff: ActiveBuff; damage: number }> {
    const due: Array<{ buff: ActiveBuff; damage: number }> = [];
    for (const buff of this.buffs.values()) {
      const dot = buff.dot;
      if (dot === undefined) continue;
      if (nowMs < dot.nextTickMs) continue;
      due.push({ buff, damage: dot.damage });
      // Advance by whole intervals so a stalled tick doesn't burst-fire.
      const elapsed = nowMs - dot.nextTickMs;
      dot.nextTickMs += dot.intervalMs * (1 + Math.floor(elapsed / dot.intervalMs));
    }
    return due;
  }

  /**
   * Remove every active buff (death/revive clear -- `revival.service.ts:171`).
   * @returns all cleared buffs so the caller can broadcast removal snapshots.
   */
  clear(): ActiveBuff[] {
    const all = [...this.buffs.values()];
    for (const buff of all) this.params.removeEffects(buff.effects);
    this.buffs.clear();
    return all;
  }

  /** Reverse a buff's effects and drop it from the map. */
  private detach(buff: ActiveBuff): void {
    this.params.removeEffects(buff.effects);
    this.buffs.delete(buff.skillId);
  }
}
