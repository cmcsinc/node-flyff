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

## Awaiting user real-client test
- Equip +STR ring → character-window ATK rises.
- Allocate STA → max HP rises immediately (no drop flicker).
- Allocate DEX → crit/dodge/hit rise; swing anim speeds up (client-side).
- Unequip +HP gear → HP clamps down (no over-max).
