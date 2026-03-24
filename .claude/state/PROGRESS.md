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
| `net/PacketReader.ts` | ⏳ Pending | — | Binary packet reading |
| `net/PacketWriter.ts` | ⏳ Pending | — | Binary packet writing |
| `net/PacketBuffer.ts` | ✅ Done | implementor | TCP stream reassembly |
| `net/LSFRCipher.ts` | ⏳ Pending | — | Per-connection LSFR encryption |
| `constants/opcodes.ts` | ⏳ Pending | — | SNSP_* opcode constants |
| `constants/objectTypes.ts` | ⏳ Pending | — | Object type enums |
| `constants/sessionState.ts` | ⏳ Pending | — | Session state enum |
| `errors.ts` | ⏳ Pending | — | FlyffError, PacketError, AuthError, GameError |
| `logger.ts` | ⏳ Pending | — | pino logger factory |
| `eventBus.ts` | ⏳ Pending | — | Typed EventEmitter |
| `cache/ICacheAdapter.ts` | ⏳ Pending | — | Interface only |
| `cache/MemoryCache.ts` | ⏳ Pending | — | In-memory (tests + dev) |
| `cache/RedisCache.ts` | ⏳ Pending | — | Redis (ioredis) |

### @flyff/ipc

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `registration.ts` | ✅ Done | implementor | Server registration logic |
| `opcodes.ts` | ✅ Done | implementor | IPC_OP opcode constants |
| `schemas/registration.schema.ts` | ✅ Done | implementor | Zod schemas for registration |
| `IpcBus.ts` | ⏳ Pending | — | Redis pub/sub + HMAC signing |
| `IpcServer.ts` | ⏳ Pending | — | Internal TLS TCP server |
| `IpcClient.ts` | ⏳ Pending | — | Internal TLS TCP client |
| `signing.ts` | ⏳ Pending | — | signIpcMessage / verifyIpcMessage |
| `circuit.ts` | ⏳ Pending | — | CircuitBreaker |

### @flyff/login-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/clusterRegistry.ts` | ✅ Done | implementor | Manages cluster server connections |
| `services/serverList.service.ts` | ✅ Done | implementor | Server list service |
| `handlers/auth.handler.ts` | ⏳ Pending | — | Login authentication handler |
| `services/auth.service.ts` | ⏳ Pending | — | Auth service (argon2id) |
| `services/token.service.ts` | ⏳ Pending | — | Session token management |
| `index.ts` | ⏳ Pending | — | Entry point |
| `compose.ts` | ⏳ Pending | — | Composition root / DI |

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
| `db.ts` | ⏳ Pending | — | Knex factory (SQLite/PG/MySQL) |
| `migrate.ts` | ⏳ Pending | — | Migration runner |
| `migrations/001_initial.ts` | ⏳ Pending | — | accounts, characters, inventory |
| `repositories/account.repo.ts` | ⏳ Pending | — | Account CRUD |
| `repositories/character.repo.ts` | ⏳ Pending | — | Character CRUD |
| `repositories/inventory.repo.ts` | ⏳ Pending | — | Inventory CRUD |

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
| — | — | — | — |

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
| 2026-03-24 | implementor | test-agent | Implemented PacketBuffer stream reassembly + tests; ready for review. |
| 2026-03-24 | researcher | implementor | Packet framing confirmed in docs: size DWORD excludes itself, header 0x5E80, opcode WORD; PacketBuffer.drain should buffer until 4+size bytes then slice 4..4+size. Sources in PROGRESS.md Research Findings. |
| 2026-03-24 | main | all | Initial PROGRESS.md created — project foundation phase |
| 2026-03-24 | main | all | Agentic workflow upgraded: RESEARCH→IMPLEMENT→VALIDATE→TEST→FIX loop, self-learning hooks, per-agent session files |

---

*Last updated: 2026-03-24*
*Update protocol: When completing a module, change its row Status + Last Agent + Notes.*
