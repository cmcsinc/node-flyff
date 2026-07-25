# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Flyff (Fly For Fun) MMORPG server emulator** written in **TypeScript**. It replicates the Login, Cluster, and World servers of the Flyff game and communicates with real Flyff game clients over TCP using the authentic binary packet protocol.

---

## Commands

This is a **pnpm monorepo** (ESM, TypeScript). Common commands:

```bash
# Install all workspace dependencies
pnpm install

# Run a specific server (dev — ts-node via tsx)
pnpm --filter @flyff/login-server dev
pnpm --filter @flyff/cluster-server dev
pnpm --filter @flyff/world-server dev

# Build all packages
pnpm -r build

# Run database migrations
pnpm --filter @flyff/database migrate

# Lint
pnpm --filter @flyff/core lint
pnpm -r lint           # lint all packages

# Run tests (Node.js native test runner with tsx)
pnpm --filter @flyff/core test
pnpm -r test
```

---

## Monorepo Structure

```text
packages/
  core/               ← @flyff/core — shared by all servers
    src/
      net/            ← PacketReader, PacketWriter, PacketBuffer, LSFRCipher
      constants/      ← opcodes.ts, objectTypes.ts, jobIds.ts, itemKinds.ts
      utils/          ← math.ts, time.ts, bitflags.ts
      errors/         ← FlyffError, PacketError, AuthError, GameError
      ipc/            ← channels.ts, schemas.ts (IPC message type definitions)
      cache/          ← ICacheAdapter.ts, RedisCache.ts, CloudflareCache.ts, MemoryCache.ts
      config.ts       ← Zod-validated env config
      logger.ts       ← pino logger
      eventBus.ts     ← typed EventEmitter
    index.ts
  ipc/                ← @flyff/ipc — secure inter-server IPC framework
    src/
      IpcBus.ts       ← Redis pub/sub with HMAC signing
      IpcServer.ts    ← internal TLS TCP server
      IpcClient.ts    ← internal TLS TCP client
      signing.ts      ← signIpcMessage / verifyIpcMessage (HMAC-SHA256)
      circuit.ts      ← CircuitBreaker
      schemas/        ← Zod schemas for every IPC message type
    index.ts
  login-server/       ← Auth + server list (port 23000)
    src/
      handlers/       ← auth.handler.ts, world.handler.ts
      services/       ← auth.service.ts, token.service.ts
      compose.ts      ← composition root (DI wiring)
      index.ts
  cluster-server/     ← Character select/create (port 38100)
    src/
      handlers/
      services/
      compose.ts
      index.ts
  world-server/       ← Gameplay entry point (port 38180) — composes domain packages
    src/
      ipc/            ← clusterListener.ts
      compose.ts      ← wires @flyff/combat, inventory, skills, quest, npc into the tick
      index.ts
  gateway/            ← @flyff/gateway — unified WebSocket server (auth+select+world, one process)

  # ── Shared world layers (used by world-server + domain packages) ──
  entities/           ← @flyff/entities — CPlayer/CMover, slot/exp/vital math, authority constants
  world-core/         ← @flyff/world-core — Player/Zone/Spawn managers + QuestHooks seam

  # ── Domain packages (carved out of world-server) ──
  combat/             ← @flyff/combat — damage formulas, melee/skill pipeline, AI FSM, handlers
  inventory/          ← @flyff/inventory — item/bag/equip/consume/drop/loot, ItemManager, ground items
  skills/             ← @flyff/skills — skill cast + learn services, handlers
  quest/              ← @flyff/quest — quest conditions/rewards, QuestTrackerSystem (QuestHooks impl)
  npc/                ← @flyff/npc — dialog/script/shop/bank/target/vicinity/mapKey services, handlers
  database/           ← @flyff/database
    src/
      repositories/   ← account.repo.ts, character.repo.ts, inventory.repo.ts
      migrations/     ← 001_initial.ts, 002_skills.ts … (Knex migration files)
      db.ts           ← Knex connection factory (SQLite3 / PG / MySQL)
      migrate.ts      ← migration runner
    index.ts
resources/            ← @flyff/resources
  src/
    loaders/          ← propItem.loader.ts, propMover.loader.ts
    parsers/          ← defineFile.parser.ts, propFile.parser.ts
  data/               ← propItem.txt, propMover.txt, etc. (game files)
tools/                ← packet-sniffer, resource-inspector (dev tools)
```

---

## Technology Stack

| Layer | Choice |
| --- | --- |
| Language | **TypeScript** (strict mode, ESM, `.ts` files) |
| Runtime | Node.js 20 LTS, ESM only |
| Database | **Knex.js** — SQLite3 (local dev), PostgreSQL or MySQL (production) |
| Persistence | **Hybrid WAL Pattern** — Embedded SQLite journal (0-latency crash recovery) + Knex Main DB sync |
| Cache / State | **ICacheAdapter** — Redis (ioredis) or Cloudflare Workers KV |
| IPC Framework | **@flyff/ipc** — HMAC-signed JSON over Redis pub/sub + internal TLS TCP |
| Validation | **Zod** — config env, IPC schemas, packet field validation |
| Logging | `pino` (structured JSON) |
| Dev runner | `tsx` (ts-node alternative, ESM-native) |
| Build | `tsup` (esbuild ESM bundles → dist/) |
| Module resolution | `Bundler` — extensionless imports in dev (tsconfig `paths`) and prod (`exports`) |
| Test runner | Node.js native (`node --test`) + `tsx` |
| Linting | ESLint + `@typescript-eslint` |

---

## Server Topology

```text
Client ──► Login Server (:23000)   — authenticate, send server list
                │ @flyff/ipc (Redis + optional TLS TCP)
Client ──► Cluster Server (:38100) — character select/create
                │ @flyff/ipc (Redis + optional TLS TCP)
Client ──► World Server (:38180)   — gameplay
```

Each server is a separate Node.js process. They communicate via **@flyff/ipc** which uses:

- **Redis pub/sub** (async events) — all messages HMAC-SHA256 signed
- **Internal TLS TCP** (sync req/res) — mutual certificate auth

See `packages/ipc/src/schemas/` for all typed IPC message schemas.

---

## Packet Protocol

Every Flyff TCP packet on the wire (v19-style framing, as implemented in `@flyff/core`):

```text
[1 byte:  0x5E marker]
[4 bytes DWORD: size]  ← bytes after these 4 (Little-Endian)
[N bytes: payload]     ← payload leads with a DWORD opcode; all integers LE
```

The payload's first DWORD is the `PACKETTYPE_*` opcode (e.g. `PACKETTYPE.JOIN = 0x0000ff00`). The dispatcher strips the 5-byte frame + leading opcode DWORD and hands the remaining fields to the handler; replies write `writeDword(PACKETTYPE.X)` as the first payload DWORD.

> Note: `CLAUDE.md` previously documented a `[4 B size][2 B 0x5E80 header][2 B opcode]` frame and an LSFR cipher. That did not match the implementation. The code uses the `0x5E` marker frame above with **CRC** integrity (not LSFR). See `packages/core/src/net/PacketBuffer.ts`.

Strings are **DWORD-length-prefixed** (not null-terminated). TCP is stream-based — always use `PacketBuffer.drain()` to reassemble frames before dispatch.

Opcodes use their original C++ `PACKETTYPE_*` names from `_Network/MsgHdr.h` (e.g. `PACKETTYPE_CERTIFY`, `PACKETTYPE_JOIN`). See `packages/core/src/constants/opcodes.ts`.

---

## Layered Architecture

Every feature follows a strict **Handler → Service → Repository** split:

| Layer | Responsibility | Must NOT |
| --- | --- | --- |
| **Handler** | Parse packet fields, validate input, call one service, send response | Access DB, implement game rules |
| **Service** | Business logic, game rules, orchestrate repos | Call `socket.write()`, write SQL |
| **Repository** | All Knex queries, return plain typed objects | Contain game logic |
| **Manager** | In-memory live state (players, zones, objects) | Persist data |
| **System** | Per-tick game simulation (combat, AI, spawn) | Handle packets |

Services communicate back to handlers via **EventBus** (`bus.emit(EV.*)`) when they need to send packets without depending on the handler layer.

Dependency injection is manual: wire singletons in each server's `compose.ts` (composition root) using an `init({ dep1, dep2 })` pattern.

---

## Naming Conventions

- **Files**: `<feature>.handler.ts`, `<feature>.service.ts`, `<entity>.repo.ts`, `<domain>.manager.ts`, `<domain>.system.ts`
- **Entity classes**: mirror C++ names — `CPlayer extends CMover`, `CCtrl extends CMover` (NPC/Monster)
- **C++ fields on entities**: keep `m_` prefix and Hungarian notation (`m_nLevel`, `m_szName`, `m_vPos`) for easy cross-referencing with original source
- **New code (not mirroring C++)**: plain `camelCase`
- **Opcode constants**: preserve `SNSP_*` naming from C++ source
- **Enums**: `Object.freeze({ KEY: value })` pattern or TypeScript `const enum`
- **Interfaces**: `I` prefix — `ICacheAdapter`, `IpcMessage`, `ICharacterRow`

Import order: Node built-ins → external npm → `@flyff/*` packages → relative imports.

---

## Code Standards

- **TypeScript strict** — `"strict": true` in every tsconfig.json, no `any`
- **ESM only** — `import`/`export` everywhere, no `require()`. No `.cjs`.
- `"type": "module"` in every `package.json`
- **No `process.exit()`** in library code — only in server entry points
- **No synchronous file I/O at runtime** — only during startup resource loading
- **No `await` inside `setInterval` tick** — defer with a queue
- Max function length ~50 lines, max file length ~300 lines
- All async functions must handle rejection (try/catch or `.catch()`)
- Use `pino` logger — never `console.log` in production code
- Custom errors extend `FlyffError` from `@flyff/core/errors.ts`
- All socket errors must be caught at the socket level to prevent server crashes
- **Zod** for all external input validation (packets, env config, IPC messages)

---

## World Server Game Loop

50ms tick drives all subsystems:

```text
PlayerManager.tick(dt) → SpawnManager.tick(dt) → AIScheduler.tick(dt)
```

The game loop must stay under 10ms. CPU-heavy work (pathfinding, collision) goes to **Worker Threads**.

### Spawn notification (NPCs/monsters) — decoupled from JOIN

Two separate concerns that must stay split:

- **Materialization** (server-side): zone NPCs + monster spawn points are instantiated ONCE at world-server boot by `SpawnManager.bootstrap()` (wired in `compose.ts`). They live in memory, independent of any player. `dwObjIndex` on each mover MUST be a real `MI_*` from `resource/defineObj.h` (active block starts line 1036) — the client's `CreateObj` → `GetMoverProp` null-derefs `OnAddObj` (`DPClient.cpp:1160`) on any value missing from its propMover table.
- **Client notification**: the ADD_OBJ snapshot for a player's zone is sent by `VicinityService.enterZone(charId)`, triggered from `MapKeyHandler` on the player's FIRST accepted `MAP_KEY` (one-shot via `CPlayer.m_vicinitySent`). MAP_KEY is the point where Neuz has finished `WORLD_READINFO`/`ReadWorld` (so `g_pWorld`+`g_pPlayer` are set and `OnAddObj` can safely create mover models).

**Never send the NPC ADD_OBJ snapshot from `JoinHandler`.** Bolting it onto JOIN races the client's async world load and desyncs the stream → `OnAddObj:1160` null-deref. JOIN sends only the self-spawn (WORLD_READINFO + the player's own ADD_OBJ). See memory `v19-npc-addobj-method-exclude-item`.

**Performance rules**:

- Zone-based broadcasting — iterate only players in the same zone, never all players
- Dirty flags (`player._dirty` Set) — only persist changed fields; flush every 30s or on disconnect
- **Hybrid WAL Persistence**: Critical state changes (items, exp) are written synchronously to an embedded local SQLite journal (`world_X_journal.sqlite`) to prevent data loss on crash without DDoS-ing the main database.
- Object pooling for frequently allocated packets and vectors

---

## Database

- **Knex.js** — works with SQLite3, PostgreSQL, and MySQL/MariaDB
- Set `DB_CLIENT=sqlite3|pg|mysql2` in `.env` to switch adapters
- SQLite3 database path: `DB_FILENAME=./dev.sqlite3` (local dev)
- All queries live in repository files only — no Knex outside repositories
- Transactions via `db.transaction(trx => ...)` Knex pattern
- Slow query threshold: 200ms (auto-logged as warn)
- Cache hot-read data via `ICacheAdapter`: `token:{token}` (TTL 30s), `session:{id}` (TTL 5min)

---

## Cache / IPC State

Use `ICacheAdapter` interface (never depend directly on Redis or Cloudflare KV):

```ts
// packages/core/src/cache/ICacheAdapter.ts
export interface ICacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  publish?(channel: string, message: string): Promise<void>;
  subscribe?(channel: string, fn: (msg: string) => void): Promise<void>;
}
```

Available implementations: `RedisCache`, `CloudflareCache`, `MemoryCache` (testing).

---

## Configuration Precedence

`loadConfig` (`packages/core/src/config/loader.ts`) merges layers last-wins:

```text
{}  →  config/default.json  →  config/<server>.json  →  config/*.yml  →  env overrides
```

Zod `.default()` in `packages/core/src/config/schemas/*.schema.ts` only fills a key when **no** layer provides it. **Runtime config files override schema defaults.** When changing a real-world default (spawn coords, ports, limits), update BOTH the schema `.default()` AND the matching key in `config/<server>.json`, then restart — config is read once at boot.

---

## Inter-Server Security

All IPC messages are HMAC-SHA256 signed with `IPC_SECRET` from env:

```ts
// Every published message includes:
{ ts: number, from: string, sig: string, payload: T }
```

Reject messages with: invalid signature, missing `ts`, age > 30s, unknown `from`.

See skill `flyff-ipc-framework` for the full framework implementation.

---

## Skills Available

This project has context-aware skills in `.claude/skills/`. They are auto-suggested by the system prompt based on keywords. Key skills:

| Skill | When to Use |
| --- | --- |
| `flyff-packet-protocol` | Packet parsing, opcodes, LSFR encryption, PacketReader/Writer |
| `flyff-emulator-arch` | Server topology, zone management, resource loading, game loop |
| `flyff-state-persistence` | Embedded SQLite WAL journal, crash recovery, dupe prevention |
| `flyff-multi-layer-arch` | Handler/Service/Repository design, EventBus, DI patterns |
| `flyff-database-layer` | Knex DB (SQLite/PG/MySQL), schema, repositories, migrations |
| `flyff-cache-layer` | ICacheAdapter, Redis, Cloudflare KV, MemoryCache |
| `flyff-interserver-ipc` | Login↔Cluster↔World messaging, player handoff, HMAC-signed pub/sub |
| `flyff-ipc-framework` | @flyff/ipc package internals, IpcBus, IpcServer/Client, security |
| `flyff-game-systems` | Combat formulas, stats, AI, skills, drops, spawns |
| `flyff-cpp-to-nodejs` | Translating C++ Flyff source to TypeScript |
| `flyff-code-standards` | File naming, JSDoc/TSDoc, ESLint, import order |
| `flyff-typescript-patterns` | TypeScript strict config, Zod, decorators, generics |
| `flyff-security` | Auth, password hashing, rate limiting, anti-cheat, input validation |
| `flyff-nodejs-patterns` | Async patterns, EventEmitter, Worker Threads, Buffer, memory |
| `flyff-testing-patterns` | tsx runner, Node test, SQLite in-memory tests, mock factories |
| `flyff-agent-workflow` | Checkpointing, session restoration, autonomous handoffs |

---

## Agentic Workflow & Session Restoration

> **OVERRIDE RULE — Task Completion & Fix Authority (2026-07-21).**
> **The user is the ONLY source of truth for whether something is complete or fixed.** This overrides every checklist, gate, and Phase-4 "mark done" instruction in `.claude/rules/08-agent-workflow.md`, `09-agentic-selflearning.md`, and any agent definition file. Three rules, all hard:
>
> 1. **No marking complete.** No agent (main or sub) may mark ANY task complete, ✅ Done, finished, or resolved — in `TodoWrite`, `SESSION.md`, `PROGRESS.md`, commit messages, PR bodies, or chat — unless the user explicitly says so (e.g. "mark it done", "ship it", "go ahead and complete"). When work passes all your checks but the user has not approved, leave the task `in_progress`, write a one-line checkpoint of what was verified, do NOT flip status, do NOT auto-commit, do NOT delete tasks.
> 2. **"Not complete" means "not working."** A task staying open is a statement that the feature/issue is NOT actually working yet. **Do not stop working on it until the user says it is fixed.** Do not hand it off as done-pending, do not park it, do not move on — keep iterating until it works or the user tells you to stop.
> 3. **Never say "fixed" (or "works", "resolved", "passing") unless the user tested it.** The agent may say "implemented", "changed", "tests pass on my side", or "ready for you to test" — never claim a fix is real until the user confirms by testing. Only the user can declare something fixed.

To ensure a "fully agentic" experience, this project follows a strict checkpointing protocol:

- **Branch-First**: Always create a working branch off `master` **before** touching any file — never commit to `master`. When work is ready, open a GitHub PR (never self-merge unless the user says so). See `.claude/rules/common/git-workflow.md` → Branch-First Workflow.
- **State File**: `.claude/state/SESSION.md` is the source of truth for the current agent session.
- **Mandatory Checkpoint**: Agents must update `SESSION.md` or the `TodoWrite` list after every significant change.
- **Restoration**: When resuming a session, always `Read` `SESSION.md` first and synchronize the active task list.
- **Checkpoint Content**: Must include the active goal, progress log, technical context (last tool used, current branch), and pending questions.
- **Skill Usage**: Trigger `flyff-agent-workflow` for any session management or handoff tasks.
