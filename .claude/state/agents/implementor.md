# Implementor Agent Session

- **Agent**: implementor
- **Active Task**: C2+C3 crit fidelity fix from C++ audit
- **Phase**: 4 — Fix (tests pass, committed)
- **Last Updated**: 2026-07-27

## Current Work — C2+C3 crit fix

- [x] C2: Remove skill crit from resolveSkillCast (IsCriticalAttack returns FALSE for skills)
- [x] C2: Update skillFormulas.test.ts — 3 tests rewritten, 17/17 pass
- [x] C3: Add pre-roll crit scaling (fMin=1.1, fMax=1.4) to resolveMelee
- [x] C3: Post-roll 2.3x multiplier moved after element factor
- [x] Both test suites pass: 17 skill + 53 formula = 70 total
- [x] Committed: ac738e0 on fix/h8-dropgold-noop

## Files changed
- `packages/combat/src/combat/skillFormulas.ts` — removed crit block + unused import
- `packages/combat/src/combat/formulas.ts` — pre-roll scaling + post-roll 2.3x
- `packages/combat/test/combat/skillFormulas.test.ts` — 3 tests rewritten

## ponytail (deferred)
- Level-advantage crit bumps (1.2/2.0 vs NPC, 1.4/1.8 as NPC)
- 4th-attack crit 2.6x (OBJSTA_ATK4)
- DST_CRITICAL_BONUS multiplier

## Reference docs
- `game/source/_Common/MoverAttack.cpp:798-804` — IsCriticalAttack
- `game/source/_Common/MoverAttack.cpp:1424-1492` — GetHitPower (pre-roll scaling)
- `game/source/_Common/MoverAttack.cpp:1659-1677` — ApplyDPC (post-roll 2.3x)
