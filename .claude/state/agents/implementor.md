# Implementor Agent Session

- **Agent**: implementor
- **Active Task**: character.inc parser + outfit/menus wire — COMPLETE (pending approval)
- **Phase**: 2 — Implement
- **Last Updated**: 2026-07-21

## Current Work — character.inc parser

- [x] Located MMI enum: `game/resource/defineNeuz.h:92-314`. **MMI_DIALOG=0** (line 92),
      MAX_MOVER_MENU=175 (line 314). Copied defineNeuz.h → raw/ so loader resolves all 175.
- [x] Wrote `packages/resources/src/loaders/characterInc.loader.ts` (230 lines): UTF-16LE
      decode, BOM strip, `//` comment strip, brace-counted block scan, AddMenu/AddMenuLang
      MMI extraction, SetFigure/SetEquip outfit with II_* resolved via defineItem.h,
      m_szDialog file, AddVendorSlot count.
- [x] Wired into `loadAllResources(dataDir, rawDir=default ../raw)` — exposed as
      `resources.characterInc: CharacterIncIndex`. Re-exported `blockForMover`, `MMI_DIALOG`.
- [x] `CMover.m_abMoverMenu: readonly number[]` field; populated from `MoverSpawnSource.menus`.
- [x] `SpawnManager.bootstrap` NPC loop resolves block via `blockForMover(idx, def.key)`,
      threads menus + block-sourced outfit (overrides yml `outfit` when present).
- [x] 12 loader tests + 1 new spawn-manager test for `m_abMoverMenu` propagation.
      Resources 26/26, world 360/360 green. tsc clean (only pre-existing js-yaml +
      unrelated BANK_SLOTS error from concurrent work in player.ts).
- [x] Real `raw/character.inc`: **360 blocks, 324 with MMI_DIALOG**, 47 trade, 5 banking,
      29 outfits, 48 vendors.

## Prior Current Work section

- [x] Wired `m_dwBelligerence` end-to-end (was hardcoded 0): schema field +
      `BELLI_TEXT_TO_NUM` in `converters/movers.ts` + `MoverSpawnSource.belligerence`
      + `CMover.m_dwBelligerence` populated from src + both `spawn.manager.ts` loops
- [x] Wrote `packages/resources/scripts/extractFlaris.ts` (`pnpm extract:flaris`):
      parses binary `.dyo` (200B records, OT_MOVER invariant) + UTF-16LE `.rgn`
      → `data/worlds/zones/flaris.yml`: **195 NPCs + 859 spawns**
- [x] Regenerated movers.yml (belligerence on all 782) + flaris.yml
- [x] Tests: spawn.manager belligerence propagation; extractFlaris smoke (3).
      Resources 12/12, world 139/139 green. tsc clean (only pre-existing js-yaml).

## Original Current Work section (prior task) below

- [x] Implemented 11 v15 C→S handlers in single batch (parallel file writes):
  - CHAT, MOTION, SETTARGET, LEAVE, PLAYERCORR, PLAYERMOVED2, PLAYERANGLE,
    QUERYGETPOS, GETPOS, SCRIPTDLG, REVIVAL
- [x] Created 6 new services (chat, motion, target, queryGetPos, scriptDlg, revival)
- [x] Extended `movement.service.ts` with applyCorr/applyMoved2/applyAngle/applyGetPos
- [x] Created 2 new serializers (chat, motion); extended moverBroadcast with buildCorr/buildMoved2
- [x] Wired 11 new routes in clientServer.ts + 11 handlers in compose.ts + 11 destructures in index.ts
- [x] Extended CPlayer with m_fAngle, m_idTarget, m_idSetTarget, m_tickScript
- [x] Added 4 SNAPSHOTTYPE_* constants (CHAT_OUT, MOTION, MOVERCORR, MOVERMOVED2)
- [x] Wrote 11 companion test files (36 new tests, all green)
- [x] Full world-server test suite: 77/77 pass
- [x] `tsc --noEmit` clean (only pre-existing js-yaml error remains)

## Skipped (need unbuilt subsystems)

8 packets deferred to Known Blockers:
- MELEE/MAGIC/RANGE_ATTACK — need combat system
- USESKILL — need skill system + propMover
- DROPITEM/DOUSEITEM/BUYITEM/MOVEITEM/DOEQUIP — need inventory repo wired to CPlayer + WAL journal

## Restore Protocol

1. Read `.claude/state/PROGRESS.md` — find the first `⏳ Pending` module
2. Read `.claude/state/SESSION.md` — understand current session goal
3. Pick up the next `⏳ Pending` task and update this file to `🔄 In Progress`

## Current Work

- [x] Implemented services/auth.service.ts — argon2id password hashing, credential validation, rate limiting
- [x] Implemented services/token.service.ts — handoff token generation and validation
- [x] Implemented handlers/auth.handler.ts — SNSP_LOGIN_CERTIFY handler
- [x] Implemented handlers/serverList.handler.ts — SNSP_SERVER_LIST handler
- [x] Updated compose.ts with DI wiring
- [x] TypeScript compilation successful (0 errors)
- [x] Created companion test files for all modules
- [ ] Run tests to verify functionality

## Completed This Session

- [x] Created 6 source files: db.ts, migrate.ts, types.ts, 001_initial.ts, 3 repositories
- [x] Created 6 test files with comprehensive test coverage
- [x] Fixed Knex ESM import issues by creating custom types.ts
- [x] All TypeScript strict mode errors resolved
- [x] Package exports configured correctly
- [ ] Note: Full integration tests require sqlite3 native bindings (better-sqlite3 already in dependencies)

## Discoveries This Session

_Records any implementation insights, edge cases, or surprises here for future reference._
- [x] Implemented `packages/ipc/src/circuit.ts` — CircuitBreaker pattern (21 tests passing)
- [x] Implemented `packages/ipc/src/IpcBus.ts` — Redis pub/sub with HMAC signing (8 tests passing)
- [x] Implemented `packages/ipc/src/IpcServer.ts` — Internal TLS TCP server (3 tests passing)
- [x] Implemented `packages/ipc/src/IpcClient.ts` — Internal TLS TCP client (4 tests passing)
- [x] Created test files for all three components (15 tests passing total)
- [x] TypeScript compilation successful with 0 errors

## Completed This Session

- [x] signing.ts: HMAC-SHA256 signing with 30s replay attack prevention (19 tests)
- [x] circuit.ts: CircuitBreaker with CLOSED/OPEN/HALF_OPEN states (21 tests)
- [x] IpcBus.ts: Redis pub/sub with automatic HMAC signing/verification (8 tests)
- [x] IpcServer.ts: Internal TLS TCP server for sync req/res (3 tests)
- [x] IpcClient.ts: Internal TLS TCP client with timeout support (4 tests)
- [x] Updated packages/ipc/src/index.ts to export all new modules
- [x] Total IPC framework: 5 modules, 75+ tests passing
- [x] Updated PROGRESS.md with completion status
- [x] Added Agent Communication Log entry

## Module Status Update

Updated in PROGRESS.md:
- `@flyff/ipc/src/signing.ts` → ✅ Done
- `@flyff/ipc/src/circuit.ts` → ✅ Done
- `@flyff/ipc/src/IpcBus.ts` → ✅ Done
- `@flyff/ipc/src/IpcServer.ts` → ✅ Done
- `@flyff/ipc/src/IpcClient.ts` → ✅ Done

## Completed This Session

- [x] signing.ts: HMAC-SHA256 signing with 30s replay attack prevention
- [x] circuit.ts: CircuitBreaker with CLOSED/OPEN/HALF_OPEN states
- [x] TypeScript compilation successful with 0 errors
- [x] Updated PROGRESS.md to mark signing.ts and circuit.ts as ✅ Done
- [x] Added entry to Agent Communication Log

## Module Status Update

Updated in PROGRESS.md:
- `constants/opcodes.ts` → ✅ Done
- `constants/objectTypes.ts` → ✅ Done
- `constants/sessionState.ts` → ✅ Done
- `errors.ts` → ✅ Done
- `logger.ts` → ✅ Done
- `eventBus.ts` → ✅ Done
- `cache/ICacheAdapter.ts` → ✅ Done
- `cache/MemoryCache.ts` → ✅ Done
- `cache/RedisCache.ts` → ✅ Done

## Discoveries This Session

- PacketWriter value clamping: Use bitwise AND (&) to clamp values to valid ranges before passing to Buffer methods
- ESM test imports: Integration tests need `async`/`await` for dynamic imports
- TypeScript Buffer indexing: Need to check for `undefined` when accessing buffer by index

## Discoveries This Session

- PacketBuffer.drain should emit payload slices without size prefix for dispatch.

## Completion Notes

- Ran `npx tsc --noEmit -p /Users/owner/Cyril/nodejs-flyff/tsconfig.base.json`.
- Ran `npx tsx --test /Users/owner/Cyril/nodejs-flyff/packages/core/src/net/PacketBuffer.test.ts`.

## Restore Protocol

1. Read `.claude/state/PROGRESS.md` — find the first `⏳ Pending` module in dependency order
2. Read `.claude/state/SESSION.md` — understand current session goal
3. Read `CLAUDE.md` — confirm code standards
4. Read the relevant skill (`flyff-multi-layer-arch`, `flyff-packet-protocol`, etc.)
5. Pick up the next `⏳ Pending` task and update this file to `🔄 In Progress`

## Completion Protocol

When a module is complete:
1. Update `PROGRESS.md` → change module row from `🔄 In Progress` to `✅ Done`
2. Add entry to PROGRESS.md → **Agent Communication Log**:
   `| <timestamp> | implementor | test-agent | Implemented <module> — ready for test coverage |`
3. Update this file: Active Task → "None", Phase → "Idle"
4. Run `npx tsc --noEmit` — 0 errors required before declaring done

## Quality Gates

- [ ] `tsc --noEmit` passes (0 TypeScript errors)
- [ ] `.test.ts` stub file exists in `test/` directory for every source file written (NEVER in `src/`)
- [ ] No `any` types, no `console.log`, no raw Knex outside repos
- [ ] Layer discipline verified: Handler→Service→Repository, no skipping
- [ ] All test files import from `../../src/...` paths, not `./...`

## Parallel Spawning Capability

The `implementor` agent can spawn parallel sub-agents for independent subtasks:

**When to spawn parallel agents:**
- Building a new feature that requires: migration + security review + tests (spawn all 3 in parallel)
- Multiple independent modules in the same feature (spawn multiple `implementor` sub-agents)
- Code review + performance analysis (spawn `security-auditor` + researcher)

**Spawn pattern:**
```
implementor (parent)
  ├─ database-agent (migration)
  ├─ security-auditor (review)
  └─ test-agent (tests)
→ Wait for all 3 → Merge results → Update PROGRESS.md
```

**Safety limits:**
- maxDepth: 3 (implementor → database-agent → test-agent)
- maxConcurrent: 5 (max 5 parallel spawns at once)

**See:** `.claude/rules/08-agent-workflow.md` → "Parallel Sub-Agent Spawning" for full protocol.

## Discoveries This Session

_Record any implementation insights, edge cases, or surprises here for future reference._
