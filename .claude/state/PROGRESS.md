# Flyff Emulator — Cross-Agent Progress Ledger

> **All agents MUST read this file at session start and update it when completing tasks.**
> This is the shared memory layer that allows agents to communicate across sessions.

---

## Project Phase: Foundation

| Status | Legend |
|--------|--------|
| ✅ Done | Implemented, tested, reviewed |
| 🔄 In Progress | Actively being worked on |
| ⏳ Pending | Not started yet |
| 🔴 Blocked | Waiting on a dependency |
| 🚫 Skipped | Intentionally deferred |

---

## Module Status

### @flyff/core

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `config/loader.ts` | ✅ Done | implementor | Config loader with YAML+JSON+env merge |
| `config/schemas/base.schema.ts` | ✅ Done | implementor | Base Zod config schema |
| `config/schemas/login.schema.ts` | ✅ Done | implementor | Login server config schema |
| `config/schemas/cluster.schema.ts` | ✅ Done | implementor | Cluster server config schema |
| `config/schemas/world.schema.ts` | ✅ Done | implementor | World server config schema |
| `config/merge.ts` | ✅ Done | implementor | Deep merge utility |
| `net/PacketReader.ts` | ✅ Done | implementor | Binary packet reading with offset pattern |
| `net/PacketWriter.ts` | ✅ Done | implementor | Binary packet writing with object pooling |
| `net/PacketBuffer.ts` | ✅ Done | implementor | TCP stream reassembly |
| `net/LSFRCipher.ts` | ✅ Done | implementor | Per-connection LSFR encryption |
| `constants/opcodes.ts` | ✅ Done | implementor | SNSP_* opcode constants with type safety |
| `constants/objectTypes.ts` | ✅ Done | implementor | Object type enums (MOVER, ITEM, CTRL, etc.) |
| `constants/sessionState.ts` | ✅ Done | implementor | Session state enum (CONNECTED, AUTHENTICATED, IN_CLUSTER, IN_WORLD) |
| `errors.ts` | ✅ Done | implementor | FlyffError, PacketError, AuthError, GameError with cause chaining |
| `logger.ts` | ✅ Done | implementor | pino logger factory with test mode silencing |
| `eventBus.ts` | ✅ Done | implementor | Typed EventEmitter with full type safety |
| `cache/ICacheAdapter.ts` | ✅ Done | implementor | Cache interface with optional pub/sub |
| `cache/MemoryCache.ts` | ✅ Done | implementor | In-memory Map implementation with lazy TTL expiry |
| `cache/RedisCache.ts` | ✅ Done | implementor | ioredis-backed implementation with subscriber connection duplication |

### @flyff/ipc

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `registration.ts` | ✅ Done | implementor | Server registration logic |
| `opcodes.ts` | ✅ Done | implementor | IPC_OP opcode constants |
| `schemas/registration.schema.ts` | ✅ Done | implementor | Zod schemas for registration |
| `signing.ts` | ✅ Done | implementor | HMAC-SHA256 signing with replay protection (19 tests passing) |
| `circuit.ts` | ✅ Done | implementor | CircuitBreaker pattern for resilient IPC (21 tests passing) |
| `IpcBus.ts` | ✅ Done | implementor | Redis pub/sub + HMAC signing (8 tests passing) |
| `IpcServer.ts` | ✅ Done | implementor | Internal TLS TCP server (3 tests passing) |
| `IpcClient.ts` | ✅ Done | implementor | Internal TLS TCP client (4 tests passing) |

### @flyff/login-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/clusterRegistry.ts` | ✅ Done | implementor | Manages cluster server connections |
| `services/serverList.service.ts` | ✅ Done | implementor | Server list service |
| `services/auth.service.ts` | ✅ Done | implementor | Auth service (argon2id, rate limiting, session management) |
| `services/token.service.ts` | ✅ Done | implementor | Handoff token generation and validation |
| `handlers/auth.handler.ts` | ✅ Done | implementor | LOGIN_CERTIFY handler with input validation |
| `handlers/serverList.handler.ts` | ✅ Done | implementor | SERVER_LIST response handler |
| `compose.ts` | ✅ Done | implementor | DI wiring with MemoryCache and EventBus |
| `index.ts` | ⏳ Pending | — | Entry point (needs TCP server implementation) |

### @flyff/cluster-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/worldRegistry.ts` | ✅ Done | implementor | World server registry with heartbeat |
| `ipc/loginRegistrar.ts` | ✅ Done | implementor | Registers with login server |
| `services/worldList.service.ts` | ✅ Done | implementor | World list management |
| `handlers/characterSelect.handler.ts` | ⏳ Pending | — | Character selection handler |
| `handlers/characterCreate.handler.ts` | ⏳ Pending | — | Character creation handler |
| `index.ts` | ⏳ Pending | — | Entry point |
| `compose.ts` | ⏳ Pending | — | Composition root / DI |

### @flyff/world-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/clusterRegistrar.ts` | ✅ Done | implementor | Registers with cluster server |
| `entities/player.ts` | ✅ Done | implementor | CPlayer with m_fAngle/m_idTarget/m_idSetTarget/m_tickScript |
| `entities/mover.ts` | ✅ Done | implementor | CMover NPC/monster entity (NPC serialize branch fields, objid-allocated) |
| `entities/npc.ts` | 🚫 Skipped | — | Folded into mover.ts — single CMover class sufficient until equipped NPCs |
| `managers/zone.manager.ts` | ✅ Done | implementor | Zone-scoped broadcast |
| `managers/object.manager.ts` | 🚫 Skipped | — | Objid allocator folded into SpawnManager (0x40000000+ range) |
| `managers/spawn.manager.ts` | ✅ Done | implementor | Bootstraps DEFAULT_SPAWNS (5 small mushpangs, Flaris zone 1); inZone() lookup; no respawn yet |
| `systems/combat.system.ts` | 🔴 Blocked | — | Need combat formulas for MELEE/MAGIC/RANGE_ATTACK |
| `systems/ai.system.ts` | ⏳ Pending | — | NPC AI state machine |
| `systems/movement.system.ts` | ✅ Done | implementor | Extended for PLAYERCORR/MOVED2/ANGLE/GETPOS |
| `systems/exp.system.ts` | ⏳ Pending | — | Exp/level system |
| `systems/drop.system.ts` | ⏳ Pending | — | Drop rolls |
| `journal.ts` | 🔴 Blocked | — | WAL journal — blocks DROPITEM/DOUSEITEM/BUYITEM/MOVEITEM/DOEQUIP |
| `index.ts` | ✅ Done | implementor | Entry point — wires all handlers |
| `systems/journalReplayer.ts` | ✅ Done | implementor | Boot crash-recovery: replays `replayed=0` journal rows via per-type handler registry before TCP listener opens (5 tests) |
| `compose.ts` | ✅ Done | implementor | DI root with 17 handlers wired |

### @flyff/database

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `db.ts` | ✅ Done | implementor | Knex factory (SQLite/PG/MySQL) with Zod validation (5 tests passing) |
| `migrate.ts` | ✅ Done | implementor | Migration runner functions |
| `migrations/001_initial.ts` | ✅ Done | implementor | Initial schema: accounts, characters, inventory, bank, skills, quick_slots |
| `repositories/account.repo.ts` | ✅ Done | implementor | Account CRUD repository (17 test methods) |
| `repositories/character.repo.ts` | ✅ Done | implementor | Character CRUD repository (22 test methods) |
| `repositories/inventory.repo.ts` | ✅ Done | implementor | Inventory CRUD with stack/split/merge (15 test methods) |
| `journal.ts` | ✅ Done | implementor | WAL journal (better-sqlite3, WAL+NORMAL pragmas, append/getUnreplayed/markReplayed, 9 tests) — gates inventory handlers |

### @flyff/resources

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `loaders/propItem.loader.ts` | ⏳ Pending | — | propItem.txt loader |
| `loaders/propMover.loader.ts` | ⏳ Pending | — | propMover.txt loader |
| `parsers/defineFile.parser.ts` | ⏳ Pending | — | defineItem.h parser |
| `parsers/propFile.parser.ts` | ⏳ Pending | — | propItem.txt parser |

---

## Test Coverage

| File | Test File | Status |
|------|-----------|--------|
| `cluster-server/src/ipc/worldRegistry.ts` | `worldRegistry.test.ts` | ✅ Exists |
| `world-server/src/ipc/clusterRegistrar.ts` | `clusterRegistrar.test.ts` | ✅ Exists |
| `core/src/config/merge.ts` | `merge.test.ts` | ❌ Missing |
| `core/src/config/schemas/cluster.schema.ts` | `cluster.schema.test.ts` | ❌ Missing |
| `core/src/config/schemas/world.schema.ts` | `world.schema.test.ts` | ❌ Missing |
| `login-server/src/services/serverList.service.ts` | `serverList.service.test.ts` | ❌ Missing |

---

## Security Audit Log

| File | Audited By | Result | Date |
|------|-----------|--------|------|
| — | — | — | — |

> When `security-auditor` reviews a file, it logs findings here.
> 🟢 = No issues | 🟡 = Minor warnings | 🔴 = Critical — must fix before merge.

---

## Research Findings

| Topic | Found By | Summary | Source |
|-------|----------|---------|--------|
| PacketBuffer stream framing | researcher | Flyff packets use DWORD size (excluding size itself), WORD header 0x5E80, WORD opcode; TCP stream must buffer until 4+size bytes then emit payload (header+opcode+payload). | /Users/owner/Cyril/nodejs-flyff/CLAUDE.md:142-153; /Users/owner/Cyril/nodejs-flyff/.claude/skills/flyff-packet-protocol/SKILL.md:14-159 |
| LSFR cipher algorithm | researcher | LSFRCipher uses key transform: `key = (key * 0x08088405 + 1) >>> 0`; XOR each byte with `key >>> ((i % 4) * 8) & 0xFF`. Key exchange: client sends SNSP_LOGIN_CERTIFY plaintext, server responds with key, all subsequent packets encrypted. | .claude/skills/flyff-packet-protocol/SKILL.md |
| PacketReader/Writer patterns | researcher | Offset-based pattern: PacketReader maintains offset pointer, auto-advances, has remaining property; PacketWriter builds chunks array, concatenates in build(), fluent interface. All integers Little-Endian. Strings are DWORD-length-prefixed, not null-terminated. | .claude/skills/flyff-packet-protocol/SKILL.md |
| Type mapping (C++ → Node.js) | researcher | BYTE=buf.readUInt8, WORD=buf.readUInt16LE, DWORD=buf.readUInt32LE, float=buf.readFloatLE, String=4-byte length prefix+ASCII. Y is vertical (up) coordinate. | .claude/skills/flyff-packet-protocol/SKILL.md |
| Core opcodes | researcher | SNSP_LOGIN_CERTIFY=0xFC03, SERVER_LIST=0xFC06, PLAYER_LIST=0x7802, CREATE_PLAYER=0x7803, SELECT_PLAYER=0xFC15, PLAYER_SNAPSHOOT=0x7E12, CHAT=0xFF00, MELEE_ATTACK=0x7E2C. | .claude/skills/flyff-packet-protocol/SKILL.md; packages/core/src/constants/opcodes.ts |

> When `researcher` agent discovers opcodes, formulas, or packet structures,
> they are logged here for all other agents to reference.

---

## Known Blockers

| Blocker | Affects | Reported By | Status |
|---------|---------|-------------|--------|
| `journal.ts` WAL not implemented | DROPITEM, DOUSEITEM, BUYITEM, MOVEITEM, DOEQUIP handlers | implementor | ✅ Done 2026-07-21 — `Journal` in `@flyff/database`, `JournalReplayer` boots before listener; handlers still need combat/skill for some |
| Combat system absent | MELEE_ATTACK, MAGIC_ATTACK, RANGE_ATTACK, USESKILL handlers | implementor | 🔴 Blocked — need target manager + damage formulas + skill propMover |
| Skill system absent | USESKILL handler | implementor | 🔴 Blocked — need skill propMover + skill state |
| `js-yaml` types missing | `packages/core/src/config/loader.ts:42` | pre-existing | 🟡 Low — install `@types/js-yaml` or write `.d.ts` shim |

---

## Lessons Learned

> Agents write here when a bug fix causes a FAIL→PASS test transition, or when a non-obvious edge case is discovered.
> The `post-tool-auto-test.mjs` hook auto-writes brief entries; agents add root-cause detail manually.

| Date | Agent | File | Lesson |
|------|-------|------|--------|
| 2026-07-21 | implementor | database/journal.ts + systems/journalReplayer.ts | WAL journal landed. `Journal` class lives in `@flyff/database` (owns better-sqlite3); `JournalReplayer` in world-server `systems/`. Boot order: `compose()` → `journalReplayer.recover()` → `server.listen()`. Journal rows use `replayed INTEGER DEFAULT 0` flag (rule 04 says mark, not delete — keeps audit trail). No caller registers a replayer yet → recover() is a no-op today; Tier 2 inventory services register handlers (`journalReplayer.register('ITEM_ADD', fn)`) when they ship. |
| 2026-07-21 | implementor | database/journal.ts | Do NOT `import type { Logger } from '@flyff/core'` inside `@flyff/database` — database tsconfig has `rootDir: src`, and resolving `@flyff/core` pulls core's source into the program → TS6059 across every core file. Use a local minimal `JournalLogger` interface (pino is structurally compatible). Database pkg was previously core-free; keep it that way. |
| 2026-07-21 | implementor | entities/mover.ts + npcSnapshot.serializer.ts | NPC ADD_OBJ uses the short `m_bPlayer=0` serialize branch (~45B), NOT the player METHOD_NONE blob. `m_szCharacterKey` must be the character.inc key (empty for monsters) — writing the display name there is a bug. Outfit = SetFigure (hairMesh/hairColor/headMesh/characterKey) + SetEquip (`uSize × {uParts:BYTE, itemId:WORD}`, no byFlag). Flaris shopkeepers have no character.inc outfit; MaDa_Homeit/MaDa_Corel do. |
| 2026-07-20 | implementor | entities/player.ts | Adding runtime-defaulted entity fields (`m_fAngle`, `m_idTarget`, etc.) via class-field initializers avoids the constructor signature growing for every new optional field. Initialize from a constant like `NULL_ID` to keep C++ semantics. |
| 2026-07-20 | implementor | test/handlers/revival.handler.test.ts | `PacketReader` rejects empty buffers (`Cannot create PacketReader from empty buffer`). Empty-body packets like REVIVAL need a dummy byte in test payloads. |
| 2026-07-20 | implementor | services/movement.service.ts | PLAYERCORR / PLAYERMOVED2 / PLAYERANGLE wire bodies look identical to PLAYERMOVED at first glance but differ: CORR=60B same, MOVED2=73B (+3 floats +BYTE), ANGLE=45B (no state block). Read C++ field lists twice before extending the serializer. |

---

## Agent Communication Log

| Timestamp | From | To | Message |
|-----------|------|----|---------|
| 2026-07-21 | implementor | all | WAL journal unblocked: `Journal` class in `@flyff/database/src/journal.ts` (better-sqlite3, WAL+NORMAL, append/getUnreplayed/markReplayed/clearAll/countUnreplayed, 9 tests) + export. `JournalReplayer` in `packages/world-server/src/systems/journalReplayer.ts` (per-type handler registry + boot recover(), 5 tests). Wired in compose.ts (config.wal.journalPath) + index.ts (recover before listen, close on SIGINT/SIGTERM). database 90/90 + world 101/101 green. Tier 2 inventory handlers (DROPITEM/MOVEITEM/DOUSEITEM/DOEQUIP/BUYITEM) can now call `journal.append()` + register replayers. Flusher (30s dirty→main DB) deferred — ponytail in compose.ts. |
| 2026-07-20 | implementor | test-agent | Implemented 11 v15 C→S handlers (CHAT, MOTION, SETTARGET, LEAVE, PLAYERCORR, PLAYERMOVED2, PLAYERANGLE, QUERYGETPOS, GETPOS, SCRIPTDLG, REVIVAL) + 7 services + 2 serializers + extensions to movement.service/moverBroadcast.serializer — 36 new tests pass, 77/77 world-server tests green. Skipped 8 packets that need combat/inventory/WAL subsystems (see Known Blockers). |
| 2026-03-24 | implementor | test-agent | Verified core utility modules (constants, errors, logger, eventBus, cache) — all tests passing (92 total tests), tsc compilation successful with 0 errors |
| 2026-03-24 | implementor | test-agent | Implemented PacketBuffer stream reassembly + tests; ready for review. |
| 2026-03-24 | researcher | implementor | Packet framing confirmed in docs: size DWORD excludes itself, header 0x5E80, opcode WORD; PacketBuffer.drain should buffer until 4+size bytes then slice 4..4+size. Sources in PROGRESS.md Research Findings. |
| 2026-03-24 | researcher | implementor | Core network layer research complete: LSFR cipher algorithm, PacketReader/Writer patterns, type mapping (BYTE/WORD/DWORD/float/String), core opcodes logged. Ready for implementation. See PROGRESS.md Research Findings for full details. |
| 2026-03-24 | implementor | test-agent | Implemented core network layer: PacketReader (29 tests), PacketWriter (35 tests), LSFRCipher (29 tests) — all passing. Ready for test coverage review. |
| 2026-03-24 | main | all | Initial PROGRESS.md created — project foundation phase |
| 2026-03-24 | main | all | Agentic workflow upgraded: RESEARCH→IMPLEMENT→VALIDATE→TEST→FIX loop, self-learning hooks, per-agent session files |
| 2026-03-24 | implementor | test-agent | Implemented IPC framework: signing.ts (19 tests passing), circuit.ts (21 tests passing) — HMAC-SHA256 message signing and CircuitBreaker pattern for resilient IPC |
| 2026-03-24 | implementor | test-agent | Implemented @flyff/ipc IpcBus.ts, IpcServer.ts, IpcClient.ts — Redis pub/sub bus, internal TLS TCP server/client with HMAC signing (15 tests passing) |
| 2026-03-24 | implementor | test-agent | Implemented @flyff/database package: Knex factory, migrations, 3 repositories (account, character, inventory) with full CRUD operations — ready for integration testing (sqlite3 native bindings needed) |
| 2026-03-24 | implementor | test-agent | Implemented @flyff/login-server auth services and handlers — AuthService (argon2id), TokenService (HMAC handoff tokens), AuthHandler (LOGIN_CERTIFY), ServerListHandler (SERVER_LIST). TypeScript compilation successful with 0 errors. Test files created, ready for test execution. |
| 2026-03-24 | main | all | NEW FEATURE: Parallel sub-agent spawning capability added to agentic workflow. All agents can now spawn parallel helpers for independent subtasks. Safety limits: maxDepth=3, maxConcurrent=5. See `.claude/rules/08-agent-workflow.md` → "Parallel Sub-Agent Spawning", `.claude/skills/flyff-parallel-spawning/SKILL.md`, and each agent's session file for usage patterns. Example: implementor can spawn database-agent + security-auditor + test-agent in parallel to build features faster. |
| 2026-03-24 | main | all | DOCUMENTATION UPDATE: Created comprehensive documentation for parallel spawning feature. See: (1) `.claude/skills/flyff-parallel-spawning/SKILL.md` — full skill guide with patterns for all agent types, (2) `docs/agent-workflow/parallel-spawning-guide.md` — user-facing guide with examples, (3) `MEMORY.md` — project memory index with feature overview, (4) `memory/parallel_spawning_feature.md` — persistent memory entry. All agents: Review the skill guide before using parallel spawning. |
| 2026-07-21 | main | all | RESOURCE MIGRATION: Copied 24 source files from `game/resource/` → `packages/resources/raw/` (editable snapshot; client keeps originals). Built txt→yml converter (`scripts/convert.ts` + `scripts/converters/{parse,movers,items,skills}.ts`), wired as `pnpm --filter @flyff/resources convert`. One run regenerates `data/`: 782 movers (606 monsters/174 npcs/2 player), 3494 items (weapons/armors/consumables/materials), 166 skills (12 job files). Schemas relaxed: mover `model` optional, mover/item/skill `name_id` accept raw `IDS_*` keys. Flaris zone spawns/NPCs remapped to real MI_* ids (Aibatt 20-23, Marche 214, Boboku 211, Lui 213, Julia 212, Infopeng 200). All 8 loader tests green. TODO: jewelry/quest item buckets, propSkillAdd.csv per-level merge, character.inc NPC outfits. |




---

*Last updated: 2026-03-24*
*Update protocol: When completing a module, change its row Status + Last Agent + Notes.*
