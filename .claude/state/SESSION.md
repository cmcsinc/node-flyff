# Session — 2026-07-23

## Active goal
Make all stats functional — wire C++ DST parameter model end-to-end.
Plan: `C:\Users\Cyan\.claude\plans\structured-coalescing-candy.md`
Override rule: never mark done/fixed until user tests. Keep tasks in_progress.

## Status
**All 7 phases implemented. Build 16/16 green. Tests 1292/0 (baseline 1262 + 30 new). Awaiting user real-client test — NOT marked fixed.**

## Done (all phases)
- **Phase 1** DST constants + ParamModel + CPlayer readers. `packages/entities/src/constants/dst.ts`, `packages/entities/src/params/ParamModel.ts` (adj/chg Int32Array, get/setDestParam/resetDestParam, applyEffects/removeEffects, pseudo fan-out, CHRSTATE bitwise; ParamView + EMPTY_PARAM_VIEW). CPlayer: `m_params`, `getStr/Sta/Dex/Int`, `getMaxHp/Mp/Fp` (DST_HP_MAX flat + DST_HP_MAX_RATE %), FP-at-JOIN ctor gap fixed.
- **Phase 2** Item DST effects parsed. `effects[]` on ItemDefinition + converter parses defineAttribute.h DST_* symbols, builds effects from dwDestParam triplets gated to equippable. reconverted (armors 1983, weapons 712) + dist rebuilt. hit_rate/parry kept top-level.
- **Phase 3** Equip apply/remove + JOIN SetEquipDstParam. equip.service applies/removes item.effects on m_params + clamps vitals + pushes SETPOINTPARAM on max decrease (sendTo dep). join.service applies equipped effects after loadInventory + recomputes maxes.
- **Phase 4** Combatant.params + un-stubs. formulas.ts: getHitMinMax += DST_CHR_DMG+ATKPOWER+ATKPOWER_RATE; calcDefense += DST_ADJDEF; getCriticalProb += DST_CHR_CHANCECRITICAL. skillFormulas: DST_ADDMAGIC, RESIST_MAGIC_RATE + element resist; deleted calcDefenseView, imports formulas.calcDefense. playerCombatant uses p.getStr/Sta/Dex/Int + m_params; moverCombatant passes EMPTY_PARAM_VIEW.
- **Phase 5** getAttackSpeed ported (MoverAttack.cpp:156): A cap 187, ATK_SPEED_PLUS table, DST_ATTACKSPEED/1000 + DST_ATTACKSPEED_RATE %, clamp [0.1,2.0]. Un-voided ATK_SPEED_PLUS. Exported. No swing gate (client-anim).
- **Phase 6** stat.service refills current HP/MP/FP to getMaxHp/Mp/Fp + pushes 3 SETPOINTPARAM after SETSTATE (mirrors client OnSetState — fixes allocate-no-visible-change). recovery.system uses p.getMaxHp/Mp/Fp.
- **Phase 7** Tests: ParamModel.test.ts (14 cases), formulas.test.ts (+5: CHR_DMG/ADJDEF/CHR_CHANCECRITICAL/getAttackSpeed DEX+clamp), equip.service.test.ts (sendTo stub), skillFormulas.test.ts (params+fields). Fixed 2 stat-allocate test expectations (sent.length 1→4).

## Notes
- `noUncheckedIndexedAccess` ON → typed-array reads need `?? fallback`.
- Root `npx tsc --noEmit` has ~322 PRE-EXISTING errors (TS7016 dist decls + test fixtures) — NOT this work. Gate = `pnpm -r build` (tsup) + `pnpm -r test`.
- Parallel `pnpm -r test` sometimes flakes on timer-heavy ipc/AI tests; each package green when run alone.

## Hardening pass (2026-07-23, post-commit 2a26866) — IN PROGRESS
Tracing each checklist behavior through real code to catch desyncs before user test.

### FIX #1 landed — equip.service clampVitals stale-max desync
- Bug: `EquipService.clampVitals` read `getMaxHp/Mp/Fp()` but never wrote back
  cached `m_nMaxHp/Mp/Fp`. Every other path (stat allocate, recovery tick, JOIN)
  refreshes them; equip was the gap.
- Failure (≤3s window until next recovery tick recomputes): equip +HP gear →
  potion/quest heal caps at STALE LOW max; unequip +HP gear → current clamped
  but cached max stayed HIGH → full-heal refills over-max flicker.
- Change: write `m_nMaxHp/Mp/Fp = getMaxHp/Mp/Fp()` in clampVitals before clamp.
  `packages/inventory/src/services/equip.service.ts:159`. +2 regression tests.
- Verified: inventory build clean, tests 87/0 (was 85).

### TRACED clean (post-Fix#1) — no desync
- **Equip +STR → ATK (#1)** — combatants.ts:39 `str: p.getStr()` (DST-adjusted) →
  getWeaponATK scales ATK off it. No double-count: sumEquipStats folds weapon
  ATK/refine/DEF/hit_rate/parry but NOT primary stats; ring STR flows only via
  DST → getStr(). Clean.
- **Allocate STA → max HP immediate (#2)** — stat.service.ts:96-104. Recomputes
  maxes into cache (m_nMax*), refills current to max, pushes 3 SETPOINTPARAM after
  SETSTATE — mirrors client OnSetState (DPClient.cpp:13376, recompute+refill). No
  drop-flicker (cache write-back present, same pattern Fix#1 added to equip). Clean.
- **Cooldown gate (#5)** — useItem.service.ts:55-88. Gate BEFORE consume
  (C++ DoUseItem:1335 order); charge NOT spent on reject; `m_cooltime[group-1]`
  set AFTER apply; groups 1-4, array size 4 (slots.ts MAX_COOLTIME_GROUP=4) →
  index in bounds. `potionCooldownMs` wired from `config.consumable` (compose:444).
  Handler emits UI_COOLTIME (not UI_NUM) on `cooltime:true` → client sweep starts
  (doUseItem.handler.ts:87-96). Clean.
- **DEX crit/dodge/hit (#3)** — formulas.ts reads `c.dex`; playerCombatant builds
  from `p.getDex()` DST-adjusted (combatants.ts:39) → +DEX gear reaches crit
  (getCriticalProb), dodge (getParrying), hit (getHR), atk-speed. SETSTATE/persist
  at combat.service.ts:321/328 correctly use RAW m_nDex (base stats; client adds
  equip bonus itself — getDex() there would double-count into DB). Clean.

## Awaiting user real-client test
- Equip +STR ring → character-window ATK rises.
- Allocate STA → max HP rises immediately (no drop flicker).
- Allocate DEX → crit/dodge/hit rise; swing anim speeds up (client-side).
- Unequip +HP gear → HP clamps down (no over-max).
- Spam HP potion → 2nd use rejected in cooldown window, UI sweep on slot.

## Magic skill crit + effect-proc gate (2026-07-24, branch `feat/magic-skill-crit-debuff-gate`)
User picked "skill crit + debuff gate" scope. Per docs `skills-research.md` #4:
skill damage **reuses melee CalcDamage**, so skill crit = the shared melee crit
branch (not its own nProbability path). nProbability is the secondary-effect
gate (stun/poison), not crit/hit.

- `resolveSkillCast` now rolls `getCriticalProb` (DEX/10 × job.fCritical +
  DST_CHR_CHANCECRITICAL); on proc, `AF_CRITICAL1` + nATK×2.3 BEFORE DEF subtract
  (same order as `resolveMelee`). Zero-damage clears the flag. Melee + magic.
- `nProbability` roll → new `SkillCastResult.effectProc` (extends MeleeResult,
  so flows through `applyHit` unchanged). Absent field = always proc. NOT applied
  yet — needs the buff/status system (gap #1).
- Tests: combat 109/0 (+10). Existing stubs moved to `int: ()=>99` to isolate
  base damage from the new 1% crit roll (vagrant fCritical=1.0, DEX 15 → prob 1).
- Commits: 51cd9ba (crit+gate), d820182 (ranged auto-attack wire — completes the
  half-committed 1ec6147 ranged path), b5c0615 (user: dispatcher+ranged tests).
- NOT marked done — awaiting user real-client test.
