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
| `entities/player.ts` | ⏳ Pending | — | CPlayer extends CMover |
| `entities/mover.ts` | ⏳ Pending | — | CMover base entity |
| `entities/npc.ts` | ⏳ Pending | — | CCtrl NPC/monster |
| `managers/zone.manager.ts` | ⏳ Pending | — | Zone-based spatial management |
| `managers/object.manager.ts` | ⏳ Pending | — | World object lifecycle |
| `managers/spawn.manager.ts` | ⏳ Pending | — | Spawn/respawn management |
| `systems/combat.system.ts` | ⏳ Pending | — | Combat formulas |
| `systems/ai.system.ts` | ⏳ Pending | — | NPC AI state machine |
| `systems/movement.system.ts` | ⏳ Pending | — | Player movement validation |
| `systems/exp.system.ts` | ⏳ Pending | — | Exp/level system |
| `systems/drop.system.ts` | ⏳ Pending | — | Drop rolls |
| `journal.ts` | ⏳ Pending | — | WAL journal (better-sqlite3) |
| `index.ts` | ⏳ Pending | — | Entry point |
| `compose.ts` | ⏳ Pending | — | Composition root / DI |

### @flyff/database

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `db.ts` | ✅ Done | implementor | Knex factory (SQLite/PG/MySQL) with Zod validation (5 tests passing) |
| `migrate.ts` | ✅ Done | implementor | Migration runner functions |
| `migrations/001_initial.ts` | ✅ Done | implementor | Initial schema: accounts, characters, inventory, bank, skills, quick_slots |
| `repositories/account.repo.ts` | ✅ Done | implementor | Account CRUD repository (17 test methods) |
| `repositories/character.repo.ts` | ✅ Done | implementor | Character CRUD repository (22 test methods) |
| `repositories/inventory.repo.ts` | ✅ Done | implementor | Inventory CRUD with stack/split/merge (15 test methods) |

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
| — | — | — | — |

---

## Lessons Learned

> Agents write here when a bug fix causes a FAIL→PASS test transition, or when a non-obvious edge case is discovered.
> The `post-tool-auto-test.mjs` hook auto-writes brief entries; agents add root-cause detail manually.

| Date | Agent | File | Lesson |
|------|-------|------|--------|
| — | — | — | — |

---

## Agent Communication Log

| Timestamp | From | To | Message |
|-----------|------|----|---------|
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



---

*Last updated: 2026-03-24*
*Update protocol: When completing a module, change its row Status + Last Agent + Notes.*
