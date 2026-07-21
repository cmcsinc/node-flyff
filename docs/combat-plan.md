# v15 Combat — Implementation Plan (architect, task #7)

Canonical formula source: `docs/combat-research.md` (sections A–E). Do not re-research — cite it.

## Scope decision (lazy-senior)

User ask = "monster takes damage and dies." Deliver **real-formula damage + death + exp/level-up** this pass. Defer (ponytail): drops/loot (propMoverEx.inc), respawn queue, equipped-weapon model (player fights unarmed), stealHP/asal/skills/party-link/berserk, PvP, player-death penalty (monsters don't hit back yet — no AI).

Resources pkg **untouched** — monster yml already carries `level/hp/attack/defense/attack_rate/dodge_rate/exp`; player entity carries `STR/STA/DEX/INT/level/job`. Job + exp tables embedded as TS constants (read from `H:\flyff\v15\Server\Resource\*.inc`).

## Numbered checklist (implementor — bottom-up)

### 1. Fixed combat data — `src/combat/tables.ts` + `src/combat/expTable.ts`
- `JOB_TABLE: readonly JobProps[32]` — 17 floats/row, indexed by job id (0=VAGRANT…31=ELEMENTOR_HERO). Source: `propJob.inc` (pasted verbatim).
- `ATK_SPEED_PLUS[18]` — MoverAttack.cpp:71.
- `ELEMENT_MATCH[6][6]` — element factor table (MoverAttack.cpp:1275).
- `AF_*` flag bits (ActionMover.h:27), `WT_*` weapon types, `ATK_*` types, `MIN_HR=20`, `MAX_HR=96`.
- `EXP_TABLE[201]` — `{ nExp1, nPxp, dwLPPoint, nLimitExp }` per level. Source: `expTable.inc`.
- `getJobProps(job)` — clamp to VAGRANT for out-of-range (NPC path).

### 2. Pure combat math — `src/combat/formulas.ts`
Mirror C++ source names as comments. Pure functions, no deps (only tables + entity types).
- **Stat getters**: `getWeaponATK`, `getHitMinMax`, `getHR`, `getParrying`, `getAttackSpeed`, `getCriticalProb`, `getBlockFactor`, `getMaxHP/MP/FP` (player) — §A.
- **Damage pipeline**: `calcATK`, `getHitPower` (normal melee roll w/ crit + element), `postCalcGeneric` (melee path: DEF subtract + block), `calcDefense`/`calcDefenseCore`, `getDamageMultiplier`, `minusHP`, `getAttackResult` (hit/miss), `isCriticalAttack` — §B.
- **NPC branch**: stats straight from `MoverCombatStats` (atk→min=max, def=naturalArmor, hr, er).
- **Player unarmed**: `getWeaponATK` returns `0` + STR-scaling handled by `getHitMinMax` fist branch (min=max=0 base → damage floors on the 10%-of-ATK NPC rule only when NPC attacker; player→NPC has no floor, so unarmed player does `max(0, ATK-DEF)` where ATK≈STR-scaled). Acceptable for v1.
- `resolveMelee(attacker, defender, rng)` → `{ hit: bool, damage: int, atkFlags: int }` top-level entry (CalcDamage equiv). Inject `rng` (xRandom) for testable deterministic outputs.

### 3. Entity extensions
- `CMover`: add combat-stats block (`m_atk, m_def, m_hr, m_er, m_expValue, m_element`); `m_idEnemies: Map<objid, number>` hit-share (v1: single-attacker); `m_bDead: boolean`. Populated by `SpawnManager` from `MoverDefinition` (`attack/defense/attack_rate/dodge_rate/exp`) via `MoverSpawnSource`.
- `CPlayer.m_nExp`: hydrate from `row.exp` in `join.service.join` (kills the existing ponytail). No new DB column (column exists per `m_nExp` comment + CharacterRow).

### 4. Serializers — `src/net/snapshot/`
- `damage.serializer.ts` (0x0013, vicinity) — `objidAttacker, dwHit, dwAtkFlags` + conditional AF_FLYING pos/angle.
- `moverDeath.serializer.ts` (0x00c7, vicinity) — `objidKiller, dwMsg`.
- `setExperience.serializer.ts` (0x0012, self-only) — `__int64 nExp1, WORD wLevel, DWORD nSkillLevel, DWORD nSkillPoint, __int64 nDeathExp, WORD wDeathLevel`.
- `setLevel.serializer.ts` (0x0011, vicinity skips self) — `WORD wLevel`.
- Add `SNAPSHOTTYPE_DAMAGE=0x0013, MOVERDEATH=0x00c7, SETEXPERIENCE=0x0012, SETLEVEL=0x0011` to `constants.ts`.

### 5. CombatService — `src/services/combat.service.ts`
Resolves target via `spawnManager.get(objid)`, gates `isMoverAttackableBy`, runs `resolveMelee(player, mover, xRandom)`, applies `minusHP` to `mover.m_nHitPoint`, records hit-share, broadcasts `DAMAGE` (vicinity). On death (`m_nHitPoint<=0`): broadcast `MOVERDEATH`, grant exp (`addExperienceSolo` — level-diff mult ≤0=1.0/1-2=0.7/3-4=0.4/≥5=0.1 + `LimitExp` cap + level-up cascade → `SETLEVEL` vicinity + `SETEXPERIENCE` self), `spawnManager.kill(id)` (remove mover), WAL-journal exp+level. Keeps the swing broadcast (existing `MeleeAttackSerializer`).

### 6. Rewire — `meleeAttack.service.ts` + `compose.ts`
`MeleeAttackService` gains `spawnManager + combatService` deps; `attack()` calls `combatService.resolveAttack(player, frame.objid)` after the motion broadcast. Handler unchanged (already reads objid). Compose wires the new deps.

### 7. Tests — `test/combat/formulas.test.ts` + `test/services/combat.service.test.ts`
- Formula unit tests with **deterministic rng** + known-input expected outputs computed by hand from §A/§B (e.g. L1 VAGRANT 15 STR vs Small Aibatt L1: expected ATK range, DEF=3, hit-rate vs DEX).
- Service test: mock socket/spawnManager, verify DAMAGE broadcast payload + exp gain + MOVERDEATH on kill + WAL journal call.

## Security gate (phase 2.5)
Self-review against `03-security.md`: target objid validated (DWORD + spawnManager hit + `isMoverAttackableBy`); damage computed server-side (never client `dwAtkFlags`); exp/gold clamped + WAL-journaled; `xRandom` server-side. Hit-roll uses server rng, not client nParam3. No client-trusted value enters damage. Spawn via security-auditor agent if user wants a formal pass.

## Gate order
1→2→(3)→4→5→6→7. `tsc --noEmit` green + formula tests green before marking #8 done.
