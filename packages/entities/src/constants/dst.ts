/**
 * DST_* destination-parameter ids -- mirrors `packages/resources/raw/defineAttribute.h:249-368`
 * (`_Common/defineAttribute.h` in source) EXACTLY.
 *
 * C++ stores per-mover adjustments in `m_adjParamAry[MAX_ADJPARAMARY]` (additive)
 * + `m_chgParamAry[MAX_ADJPARAMARY]` (override; `CHG_SENTINEL` = unused), read
 * via `GetParam(dst, def)` (`MoverParam.cpp:2746`). Values `0..93` index the
 * arrays directly; values `>= 10000` are **pseudo-params** that fan out via the
 * `SetDestParam` switch (e.g. `DST_STAT_ALLUP`→STR/DEX/INT/STA) and are NOT
 * stored at their own index.
 *
 * Only the subset the server consumes today is listed; the raw header remains
 * the source of truth for the rest.
 *
 * @module constants/dst
 */

/** Array bound (`defineAttribute.h:346`). Valid array indices are `0..93`. */
export const MAX_ADJPARAMARY = 94;

/**
 * `m_chgParamAry` sentinel = "no override" (`MoverParam.cpp:279`). `GetParam`
 * returns the chg value only when it differs from this sentinel.
 */
export const CHG_SENTINEL = 0x7fffffff;

export const DST = Object.freeze({
  STR: 1,
  DEX: 2,
  INT: 3,
  STA: 4,
  /** Crit chance override (`getCriticalProb` adds this). */
  CHR_CHANCECRITICAL: 9,
  SPEED: 11,
  ABILITY_MIN: 12,
  ABILITY_MAX: 13,
  MASTRY_EARTH: 15,
  MASTRY_FIRE: 17,
  MASTRY_WATER: 18,
  MASTRY_ELECTRICITY: 19,
  MASTRY_WIND: 20,
  ATTACKSPEED: 24,
  /** Bonus sword damage (`defineAttribute.h:25`) -- weapon mastery via GetPlusWeaponATK. */
  SWD_DMG: 25,
  ADJDEF: 26,
  RESIST_MAGIC: 27,
  RESIST_ELECTRICITY: 28,
  RESIST_FIRE: 30,
  RESIST_WIND: 31,
  RESIST_WATER: 32,
  RESIST_EARTH: 33,
  /** Bonus axe damage (`defineAttribute.h:34`) -- weapon mastery via GetPlusWeaponATK. */
  AXE_DMG: 34,
  /** Bonus yoyo damage (`defineAttribute.h:5`) -- weapon mastery via GetPlusWeaponATK. */
  YOY_DMG: 5,
  /** Bonus bow damage (`defineAttribute.h:6`) -- weapon mastery via GetPlusWeaponATK. */
  BOW_DMG: 6,
  /** Bonus knuckle damage (`defineAttribute.h:21`) -- weapon mastery via GetPlusWeaponATK. */
  KNUCKLE_DMG: 21,
  HP_MAX: 35,
  MP_MAX: 36,
  FP_MAX: 37,
  HP: 38,
  MP: 39,
  FP: 40,
  HP_RECOVERY: 41,
  MP_RECOVERY: 42,
  FP_RECOVERY: 43,
  ADJ_HITRATE: 47,
  /** Flat attack-speed bonus (stored /1000, see `GetAttackSpeed`). */
  ATTACKSPEED_RATE: 51,
  HP_MAX_RATE: 52,
  MP_MAX_RATE: 53,
  FP_MAX_RATE: 54,
  IMMUNITY: 61,
  ADDMAGIC: 62,
  /** Flat damage bonus (`GetHitMinMax` adds to min/max). */
  CHR_DMG: 63,
  /** Character-state bits -- bitwise-OR into adj (not additive). */
  CHRSTATE: 64,
  PARRY: 65,
  /** Death-exp-penalty recovery % (`defineAttribute.h:366`); set by Resurrection skill. */
  RECOVERY_EXP: 71,
  ATKPOWER_RATE: 66,
  /** Crit extra damage on a crit hit. */
  CRITICAL_BONUS: 77,
  /** Flat attack-power bonus (`GetHitMinMax` adds). */
  ATKPOWER: 83,
  /** Percentage defense modifier (`GetDEFMultiplier`); positive = more DEF. */
  ADJDEF_RATE: 72,
  /** Attack-range % bonus (`defineAttribute.h:387`); Hawkeye scales GetAttackRange. */
  HAWKEYE_RATE: 90,
  RESIST_MAGIC_RATE: 91,

  // pseudo-params (>= 10000) -- fan out via setDestParam switch, never stored.
  GOLD: 10000,
  RESIST_ALL: 10002,
  STAT_ALLUP: 10003,
  HPDMG_UP: 10004,
  LOCOMOTION: 10010,
  MASTRY_ALL: 10011,
} as const);

export type DstId = typeof DST[keyof typeof DST];

/**
 * `DST_CHRSTATE` state bits (`defineAttribute.h` `CHS_*`). OR-ed into the
 * CHRSTATE adj pool by stun/poison/slow/debuff skills; read to gate actions
 * (`isStunned`). Values mirror C++ `CHS_*` exactly -- earlier code had STUN
 * and POISON inverted, so stun debuffs (POWERSTUMP `CHS_STUN=0x8`) never
 * tripped the gate. The full combat-side attack-flag set (`AF_CRITICAL`,
 * `AF_PUSH`, ...) is a *different* bitfield in `@flyff/combat`.
 */
export const CHRSTATE_BITS = Object.freeze({
  STUN: 0x00000008,    // CHS_STUN -- cannot act (no attack/cast/move)
  DARK: 0x00000100,    // CHS_DARK -- blindness
  POISON: 0x00000800,  // CHS_POISON -- DoT
  SLOW: 0x00001000,    // CHS_SLOW -- movement slow
  BLEEDING: 0x00008000,// CHS_BLEEDING -- DoT
  SILENT: 0x00010000,  // CHS_SILENT -- silence (no cast)
  SLEEP: 0x00200000,   // CHS_SLEEPING -- stunned (defineAttribute.h)
} as const);

