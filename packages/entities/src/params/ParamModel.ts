/**
 * DST destination-parameter model -- port of the C++ `m_adjParamAry` /
 * `m_chgParamAry` two-array stat-adjustment system (`_Common/MoverParam.cpp`).
 *
 * Two `Int32Array(MAX_ADJPARAMARY)` back both equip bonuses and (future) buffs:
 * - `adj` -- additive adjustments (ring +STR, armor +DEF, buff +ATK). Most item
 *   bonuses land here.
 * - `chg` -- replacement/override values. `CHG_SENTINEL` = unused. When set,
 *   `get` returns it outright, ignoring base + adj (a buff that hard-sets HP).
 *
 * `get(dst, def)` precedence (`GetParam`, `MoverParam.cpp:2746`):
 *   chg-override > adj+default > default
 *
 * `setDestParam` / `resetDestParam` port the `SetDestParam` (`:2237`) /
 * `ResetDestParam` (`:2670`) dispatch:
 * - pseudo-params (`DST_STAT_ALLUP`, `DST_RESIST_ALL`, `DST_HPDMG_UP`,
 *   `DST_LOCOMOTION`, `DST_MASTRY_ALL`) fan out to their real array slots.
 * - `DST_CHRSTATE` / `DST_IMMUNITY` are bitwise-OR (states are bit flags);
 *   reset clears those bits with `&= ~val`.
 * - everything else is additive; reset subtracts.
 *
 * Pure data -- no socket/packet/entity deps. The active-buff timer/expiry layer
 * that will drive timed `setDestParam` calls is a separate system (ponytail).
 *
 * @module entities/params/ParamModel
 */

import { CHG_SENTINEL, DST, MAX_ADJPARAMARY } from '../constants/dst';

/** Read-only view combat formulas consume. */
export interface ParamView {
  get(dst: number, def: number): number;
}

/** A single item/buff DST effect (propItem `dwDestParam*` / `nAdjParamVal*` triplet). */
export interface DstEffect {
  /** Destination `DST_*` id (array index 0..93, or a pseudo-param >= 10000). */
  dst: number;
  /** Additive adjustment (most item bonuses). */
  adj: number;
  /** Override value; omit/`CHG_SENTINEL` for "no override". */
  chg?: number;
}

/** ParamView over an empty adjustment table -- `get` always returns `def`. */
export const EMPTY_PARAM_VIEW: ParamView = Object.freeze({
  get: (_dst: number, def: number) => def,
});

/** Five elements fanned out by `DST_RESIST_ALL` / `DST_MASTRY_ALL`. */
const ALL_ELEMENTS = [DST.RESIST_FIRE, DST.RESIST_WATER, DST.RESIST_ELECTRICITY, DST.RESIST_WIND, DST.RESIST_EARTH];
const ALL_MASTRY = [DST.MASTRY_FIRE, DST.MASTRY_WATER, DST.MASTRY_ELECTRICITY, DST.MASTRY_WIND, DST.MASTRY_EARTH];

export class ParamModel implements ParamView {
  readonly adj: Int32Array;
  readonly chg: Int32Array;

  constructor() {
    this.adj = new Int32Array(MAX_ADJPARAMARY);
    this.chg = new Int32Array(MAX_ADJPARAMARY).fill(CHG_SENTINEL);
  }

  /** `GetParam` -- chg-override > adj+default > default. */
  get(dst: number, def: number): number {
    if (dst < 0 || dst >= MAX_ADJPARAMARY) return def;
    const chg = this.chg[dst] ?? CHG_SENTINEL;
    if (chg !== CHG_SENTINEL) return chg;
    const adj = this.adj[dst] ?? 0;
    return adj !== 0 ? def + adj : def;
  }

  /**
   * `SetDestParam` (`MoverParam.cpp:2237`). Applies one adjustment. `chg` omitted
   * or `CHG_SENTINEL` = additive-only (the equip-bonus norm).
   */
  setDestParam(dst: number, adj: number, chg: number = CHG_SENTINEL): void {
    if (this.applyPseudo(dst, adj, chg, /*add*/ true)) return;
    if (dst < 0 || dst >= MAX_ADJPARAMARY) return;
    if (dst === DST.CHRSTATE || dst === DST.IMMUNITY) {
      this.adj[dst] = (this.adj[dst] ?? 0) | adj; // states are bit flags
    } else {
      this.adj[dst] = (this.adj[dst] ?? 0) + adj;
    }
    if (adj === 0 && chg !== CHG_SENTINEL) {
      this.chg[dst] = chg; // chg-only override
    }
  }

  /** `ResetDestParam` (`MoverParam.cpp:2670`) -- reverse of `setDestParam`. */
  resetDestParam(dst: number, adj: number, chg: number = CHG_SENTINEL): void {
    if (this.applyPseudo(dst, adj, chg, /*add*/ false)) return;
    if (dst < 0 || dst >= MAX_ADJPARAMARY) return;
    if (dst === DST.CHRSTATE || dst === DST.IMMUNITY) {
      this.adj[dst] = (this.adj[dst] ?? 0) & ~adj; // clear state bits
    } else {
      this.adj[dst] = (this.adj[dst] ?? 0) - adj;
    }
    if (adj === 0 && chg !== CHG_SENTINEL) {
      this.chg[dst] = CHG_SENTINEL; // clear override
    }
  }

  /** Apply all of an item's DST effects (equip). Additive order is commutative. */
  applyEffects(effects: readonly DstEffect[]): void {
    for (const e of effects) this.setDestParam(e.dst, e.adj, e.chg ?? CHG_SENTINEL);
  }

  /** Remove all of an item's DST effects (unequip) -- mirror of `applyEffects`. */
  removeEffects(effects: readonly DstEffect[]): void {
    for (const e of effects) this.resetDestParam(e.dst, e.adj, e.chg ?? CHG_SENTINEL);
  }

  /**
   * Fan out pseudo-params (`>= 10000`) to their real array slots. Returns true
   * if `dst` was a pseudo-param (caller skips the normal path). Port of the
   * `SetDestParam` switch head (`MoverParam.cpp:2250-2432`).
   */
  private applyPseudo(dst: number, adj: number, chg: number, add: boolean): boolean {
    const fn = add ? this.setDestParam : this.resetDestParam;
    switch (dst) {
      case DST.STAT_ALLUP:
        fn.call(this, DST.STR, adj, chg);
        fn.call(this, DST.DEX, adj, chg);
        fn.call(this, DST.INT, adj, chg);
        fn.call(this, DST.STA, adj, chg);
        return true;
      case DST.RESIST_ALL:
        for (const e of ALL_ELEMENTS) fn.call(this, e, adj, chg);
        return true;
      case DST.MASTRY_ALL:
        for (const e of ALL_MASTRY) fn.call(this, e, adj, chg);
        return true;
      case DST.HPDMG_UP:
        fn.call(this, DST.HP_MAX, adj, chg);
        fn.call(this, DST.CHR_DMG, adj, chg);
        return true;
      case DST.LOCOMOTION:
        fn.call(this, DST.SPEED, adj, chg);
        fn.call(this, 68 /* DST_JUMPING */, adj * 3, chg);
        return true;
      default:
        return false;
    }
  }
}
