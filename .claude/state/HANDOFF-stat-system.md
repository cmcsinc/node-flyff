# Handoff — stat system + consumable cooldown (2026-07-23)

Self-contained session handoff. Read this on another device to pick up where this
session left off. Mirrors `.claude/state/SESSION.md` + memory
`v15-stat-dst-param-model-shipped.md` (which live in the user home and may not be
present on the other machine).

---

## Active goal

Make all character stats functional — wire the C++ DST parameter model
end-to-end so every primary stat (STR/STA/DEX/INT) and every equip bonus
measurably affects damage / DEF / HP / MP / FP / dodge / hit / crit / attack-speed.
Plus a consumable cooldown (CooltimeMgr port) that landed in the same tree.

Plan file: `C:\Users\Cyan\.claude\plans\structured-coalescing-candy.md`

### OVERRIDE RULE (hard, from CLAUDE.md)
**The user is the ONLY source of truth for "complete/fixed."** Never mark any
task ✅Done / fixed / works / resolved in TodoWrite, SESSION.md, PROGRESS.md,
commits, PRs, or chat unless the user explicitly says so. Leave tasks
`in_progress`. Say "implemented", "tests pass on my side", "ready for you to
test" — never "fixed" until the user confirms by testing. A task staying open
means "not actually working yet."

---

## Current state (pre-commit)

- **All implementation done. Build 16/16 green. Tests 1292/0** (baseline 1262
  + 30 new). No code changed since that green run — safe to trust.
- **NOT marked fixed** — awaiting user real-client test (see checklist below).
- All 7 stat phases + the cooldown feature are code-complete.

---

## What shipped in this commit (one commit, two features)

`compose.ts` physically couples both features (stat lines + cooldown line in the
same file), and no interactive patch mode was available, so they ship as one
build-green commit with a structured body.

### Feature 1 — DST parameter model (stats functional)

Root bug fixed: Flyff items have NO dedicated STR/STA/DEF columns. Every gear
+stat lives in the generic `dwDestParam{1,2,3}` / `nAdjParamVal{1,2,3}` /
`dwChgParamVal{1,2,3}` triplets where `dwDestParam` is a `DST_*` symbol. The
converter was dropping them — rings/earrings/sets with +STR did nothing.

Ported (C++ ref in-repo: `_Common/MoverParam.cpp`, `_Common/MoverAttack.cpp`):

- **NEW** `packages/entities/src/constants/dst.ts` — DST enum from
  `defineAttribute.h` (1..94 + pseudo 10000+), `MAX_ADJPARAMARY=94`,
  `CHG_SENTINEL=0x7fffffff`.
- **NEW** `packages/entities/src/params/ParamModel.ts` — `adj`/`chg` Int32Array
  port of `m_adjParamAry`/`m_chgParamAry`. `get(dst,def)` precedence =
  chg-override > adj+def > def. `setDestParam`/`resetDestParam` dispatch:
  pseudo fan-out (STAT_ALLUP→4 stats, RESIST_ALL→5 elem, HPDMG_UP→HP_MAX+CHR_DMG,
  LOCOMOTION→SPEED+JUMPING*3, MASTRY_ALL→5), DST_CHRSTATE/DST_IMMUNITY bitwise-OR,
  default additive. `applyEffects`/`removeEffects` for equip. `ParamView`
  interface + `EMPTY_PARAM_VIEW`.
- **CPlayer** (`packages/entities/src/player.ts`): `m_params`, `getStr/Sta/Dex/
  Int()` (= `m_nX + GetParam(DST_X,0)`, floor 1), `getMaxHp/Mp/Fp()` (origin ×
  `1 + DST_*_RATE/100` + `DST_*_MAX` flat). FP-at-JOIN ctor gap fixed.
- **Converter** (`packages/resources/scripts/converters/items.ts` +
  `src/schemas/item.schema.ts`): `effects[]` on ItemDefinition, parsed from
  triplets gated to equippable. `data/items/{armors,materials,weapons}.yml`
  reconverted. `hit_rate`/`parry` KEPT top-level (equipStats still reads them).
- **Equip** (`packages/inventory/src/services/equip.service.ts`): equip applies
  item.effects, unequip removes, vitals clamp + push SETPOINTPARAM on max-loss.
  JOIN (`packages/world-server/src/services/join.service.ts`) runs
  `applyEquipDstParams` (re-applies all equipped effects + recompute maxes).
- **Combat** (`packages/combat/src/combat/`): `Combatant.params` added.
  Un-stubbed: `DST_CHR_DMG`/`ATKPOWER`/`ATKPOWER_RATE` (getHitMinMax),
  `DST_ADJDEF` (calcDefense), `DST_CHR_CHANCECRITICAL` (getCriticalProb),
  `DST_ADDMAGIC`/`RESIST_MAGIC_RATE`/element-resist (skillFormulas). Deleted
  dup `calcDefenseView`. `playerCombatant` reads buffed stats via getters +
  attaches `m_params`; `moverCombatant` passes `EMPTY_PARAM_VIEW`.
- **getAttackSpeed** ported (MoverAttack.cpp:156): A cap 187, `ATK_SPEED_PLUS`
  table (un-voided), DST_ATTACKSPEED/1000 + DST_ATTACKSPEED_RATE %, clamp
  [0.1,2.0]. No swing gate — attack speed is CLIENT-side animation.
- **stat.service** (`packages/world-server/src/services/stat.service.ts`):
  after allocation refills current HP/MP/FP to new max + pushes 3 SETPOINTPARAM
  (mirrors client `OnSetState` DPClient.cpp:13376 — fixes "allocate stat → HP
  drops next tick" desync). `recovery.system` uses `p.getMaxHp/Mp/Fp`.

### Feature 2 — Consumable cooldown (CooltimeMgr port)

HP potion anti-spam via `CPlayer.m_cooltime[4]` groups (food/pill/skill + potion).

- **NEW** `packages/inventory/src/services/cooltime.ts` + test — `cooltimeGroup()`
  resolves group + ms from propItem data, potion-group fallback to config.
- `packages/entities/src/constants/slots.ts` — `COOLTIME_GROUP`, `MAX_COOLTIME_GROUP`.
- `packages/core/src/config/schemas/world.schema.ts` — `ConsumableConfigSchema`
  (`potionCooldownMs` default 1000).
- `config/world-server.json` — `consumable.potionCooldownMs: 1000`.
- `packages/inventory/src/services/useItem.service.ts` — cooldown gate BEFORE
  afford (C++ DoUseItem:1335 order), `m_cooltime` set, `cooltime` flag on result.
- `packages/inventory/src/handlers/doUseItem.handler.ts` + `updateItem.serializer.ts`
  — `buildUpdateItemCooltime` (UI_COOLTIME=8) echo so client starts sweep.
- `packages/world-server/src/compose.ts` — `potionCooldownMs: config.consumable...`.

### Already-committed (NOT in this commit)
- "Consume must echo UPDATE_ITEM" (memory `v15-consume-must-echo-updateitem`) —
  user-confirmed 2026-07-23, already in HEAD. The `buildUpdateItemCount` echo
  is pre-existing; this commit only adds the cooltime branch next to it.

---

## Key non-obvious facts

- **Attack speed is CLIENT-side animation** (`m_fAniSpeed=GetAttackSpeed`,
  ActionMoverMsg.cpp:660); server does NOT gate swing cadence. The port is for
  correctness + future DST_ATTACKSPEED buffs, not a server swing timer.
- **Active-buff/timer system** (timed DST effects, expiry, MODIFYMODE sync) is
  the documented ponytail — the model is ready for it but it's not built.
- **`noUncheckedIndexedAccess` is ON** → typed-array reads need `?? fallback`.
- **Root `npx tsc --noEmit` has ~322 PRE-EXISTING errors** (TS7016 dist decls
  + test fixtures) — NOT this work. Real gate = `pnpm -r build` (tsup) +
  `pnpm -r test`.
- **Parallel `pnpm -r test` sometimes flakes** on timer-heavy ipc/AI tests;
  each package is green when run alone.
- **Servers consume `@flyff/resources` via dist** — rebuild dist after any
  resource src/data change or servers run stale schema.
- **Dev servers run from repo root**: `pnpm server:login|cluster|world`
  (NOT `pnpm --filter <pkg> dev`) — config/resource/db paths are cwd-relative.

---

## Awaiting user real-client test (THE unblocker)

Do NOT mark anything complete until the user runs these on a real v15 client:

1. Equip a +STR ring → character-window ATK rises.
2. Allocate STA → max HP rises immediately (no drop flicker).
3. Allocate DEX → crit/dodge/hit rise; swing anim speeds up (client-side).
4. Unequip +HP gear → HP clamps down (no over-max).
5. (cooldown) Spam HP potion → second use rejected within the cooldown window,
   UI cooldown sweep appears on the slot.

If any desync, fix that specific behavior; do not start the buff/timer ponytail
without confirmation.

---

## Files touched (full list)

**Stat — new:** `packages/entities/src/constants/dst.ts`,
`packages/entities/src/params/ParamModel.ts`,
`packages/entities/test/params/ParamModel.test.ts`

**Stat — modified:** `packages/entities/src/player.ts`,
`packages/entities/src/index.ts`, `packages/entities/test/player.test.ts`,
`packages/resources/src/schemas/item.schema.ts`,
`packages/resources/scripts/converters/items.ts`,
`packages/resources/data/items/armors.yml`,
`packages/resources/data/items/materials.yml`,
`packages/resources/data/items/weapons.yml`,
`packages/inventory/src/services/equip.service.ts`,
`packages/inventory/src/index.ts`,
`packages/combat/src/combat/combatants.ts`,
`packages/combat/src/combat/formulas.ts`,
`packages/combat/src/combat/skillFormulas.ts`,
`packages/combat/test/combat/formulas.test.ts`,
`packages/combat/test/combat/skillFormulas.test.ts`,
`packages/world-server/src/services/join.service.ts`,
`packages/world-server/src/services/stat.service.ts`,
`packages/world-server/src/systems/recovery.system.ts`,
`packages/world-server/src/compose.ts`,
`packages/world-server/test/handlers/modifyStatus.handler.test.ts`,
`packages/world-server/test/services/stat.service.test.ts`

**Cooldown — new:** `packages/inventory/src/services/cooltime.ts`,
`packages/inventory/test/services/cooltime.test.ts`

**Cooldown — modified:** `packages/entities/src/constants/slots.ts`,
`packages/core/src/config/schemas/world.schema.ts`,
`config/world-server.json`,
`packages/inventory/src/services/useItem.service.ts`,
`packages/inventory/src/handlers/doUseItem.handler.ts`,
`packages/inventory/src/net/snapshot/updateItem.serializer.ts`,
`packages/inventory/test/services/useItem.service.test.ts`,
`packages/inventory/test/net/snapshot/updateItem.serializer.test.ts`

**Shared (entangled):** `packages/world-server/src/compose.ts` (stat + cooldown).

---

## How to continue on the other device

1. `git pull` (this commit lands the work).
2. `pnpm install` (no new deps in this commit, but safe).
3. `pnpm -r build` → expect 15/15 or 16/16 green.
4. `pnpm -r test` → expect all green (parallel ipc/AI flake = rerun per-package).
5. Optionally `pnpm server:world` from repo root to confirm clean boot.
6. Wait for the user's real-client test results (checklist above) before any
   "done". Keep all 7 stat phase tasks `in_progress` in TodoWrite.
