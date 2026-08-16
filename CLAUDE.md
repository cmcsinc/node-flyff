# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project Overview

A **Flyff (Fly For Fun) v19 MMORPG server emulator** in **TypeScript**. It replicates the
Login, Cluster, and World servers and talks to real Flyff clients over TCP using the
authentic binary packet protocol.

**This is a port, not new development.** Every feature, bug, formula, packet structure, and
game rule already has a working C++ implementation in `game/source/`. When a task is unclear,
read the C++ and translate — do not design, speculate, or "best-effort" from scratch. The C++
behavior is the spec; if it contradicts a design idea, the C++ wins. Only `game/source/` in
this repo counts as reference — external Flyff source trees are banned. Known TS↔C++
deviations live in `docs/c++-fidelity-audit.md`.

## Non-Negotiables

> **OVERRIDE RULE — Task Completion & Fix Authority.**
> **The user is the ONLY source of truth for whether something is complete or fixed.** This
> overrides every checklist, gate, and "mark done" instruction in any rule, skill, or agent
> definition file. Three hard rules:
>
> 1. **No marking complete.** No agent (main or sub) may mark ANY task complete, ✅ Done,
>    finished, or resolved — in `TaskUpdate`, `SESSION.md`, `PROGRESS.md`, commit messages,
>    PR bodies, or chat — unless the user explicitly says so ("mark it done", "ship it").
>    When work passes all your checks but the user has not approved: leave the task
>    `in_progress`, write a one-line checkpoint of what was verified, do NOT flip status, do
>    NOT auto-commit, do NOT delete tasks.
> 2. **"Not complete" means "not working."** An open task states the feature is NOT working
>    yet. Keep iterating until it works or the user tells you to stop. Do not park it.
> 3. **Never say "fixed"** (or "works", "resolved", "passing") unless the user tested it. Say
>    "implemented", "changed", "tests pass on my side", or "ready for you to test".

- **Never fabricate** a packet structure, opcode, or formula. Research `game/source/` (skill
  `flyff-research`) or ask the user.
- **Test target is always `master`.** The user tests everything on `master` in one go, never
  on feature branches. Branch during development, but consolidate to `master` for handoff.
- **No `.test.ts` under `src/`** — tests live in `test/`, mirroring `src/`. See rule 06.
- **Never commit** unless the user asks.

## Commands

pnpm monorepo, ESM, TypeScript. Dev servers run **from the repo root** (paths are cwd-relative).

```bash
pnpm install                        # install all workspace deps
pnpm server:login                   # run a server (also: server:cluster, server:world)
pnpm -r build                       # build all packages
pnpm -r test                        # test all (node:test via tsx)
pnpm --filter @flyff/core test      # test one package
pnpm -r lint
```

The **dev DB is created by `packages/login-server/src/seed.ts`, not `knex migrate`**. A new
migration must be added in three places: the knex migration file, the `MIGRATIONS` array in
`seed.ts`, and the raw-SQL mirror in the admin package's `migrate.ts`.

## Packages

```text
packages/
  core/          @flyff/core — PacketReader/Writer/Buffer, opcodes, config (Zod), logger, eventBus, cache
  ipc/           @flyff/ipc — HMAC-signed Redis pub/sub + internal TLS TCP, Zod schemas, CircuitBreaker
  login-server/  auth + server list (:23000) — also owns seed.ts
  cluster-server/character select/create (:38100)
  world-server/  gameplay entry (:38180) — composes the domain packages into the tick
  gateway/       unified WebSocket server (auth+select+world in one process)
  entities/      CPlayer/CMover, slot/exp/vital math, authority constants
  world-core/    Player/Zone/Spawn managers + QuestHooks seam
  combat/        damage formulas, melee/skill pipeline, AI FSM
  inventory/     item/bag/equip/consume/drop/loot, ground items
  skills/        skill cast + learn
  quest/         quest conditions/rewards, QuestTrackerSystem
  npc/           dialog/script/shop/bank/target/vicinity/mapKey
  database/      Knex repositories + migrations (must NOT import @flyff/core)
  admin/         admin panel (Next.js) + supervisor daemon
resources/       @flyff/resources — prop*.txt loaders/parsers (imports from dist — rebuild after data changes)
tools/           packet-sniffer, resource-inspector, res-reader
```

Each package has `src/` (source) and `test/` (tests mirroring src). Every `package.json` is
`"type": "module"`.

## Stack

TypeScript strict + ESM only · Node 20 · Knex (SQLite3 dev / PG / MySQL prod) · hybrid WAL
persistence (embedded SQLite journal + main DB sync) · `ICacheAdapter` (Redis / CF KV /
Memory) · Zod validation · pino logging · `tsx` dev runner · `tsup` build · `Bundler` module
resolution (extensionless imports) · `node:test` runner · ESLint + `@typescript-eslint`.

## Server Topology

```text
Client → Login (:23000)    authenticate, send server list
Client → Cluster (:38100)  character select/create
Client → World (:38180)    gameplay
```

Separate Node processes, communicating only via `@flyff/ipc` (never raw Redis). All messages
HMAC-SHA256 signed with `IPC_SECRET`; reject invalid signature, missing `ts`, or age > 30s.
Channels are `<domain>:<action>`. Schemas in `packages/ipc/src/schemas/`.

## Packet Protocol

Every packet on the wire (v19 framing, as implemented in `@flyff/core`):

```text
[1 byte:  0x5E marker]
[4 bytes DWORD: size]   ← bytes after these 4 (Little-Endian)
[N bytes: payload]      ← leads with a DWORD opcode; all integers LE
```

The payload's first DWORD is the `PACKETTYPE_*` opcode (e.g. `PACKETTYPE.JOIN = 0x0000ff00`).
The dispatcher strips the 5-byte frame + opcode DWORD and hands the rest to the handler;
replies write `writeDword(PACKETTYPE.X)` first. Integrity is **CRC**, not LSFR.

Strings are **DWORD-length-prefixed**, not null-terminated. TCP is a stream — always
reassemble with `PacketBuffer.drain()` before dispatch. Broadcasts must `framePacket()` at the
`socket.write` boundary. Opcode constants keep their C++ `PACKETTYPE_*` / `SNSP_*` names.

## Layered Architecture

| Layer | Responsibility | Must NOT |
| --- | --- | --- |
| **Handler** | Parse + validate packet fields, call one service, write the response | Touch the DB, hold game rules |
| **Service** | Business logic, game rules, orchestrate repos, `appendJournal()` | Call `socket.write()`, write SQL |
| **Repository** | All Knex queries, return plain typed objects | Contain game logic |
| **Manager** | In-memory live state (players, zones, objects) | Persist data |
| **System** | Per-tick simulation (combat, AI, spawn) | Handle packets, `await` in the tick |

Services reach handlers via EventBus (`bus.emit(EV.*)`). DI is manual: wire singletons in each
server's `compose.ts` using `init({ dep1, dep2 })` — never `new` inside modules, never global
singletons.

Entity classes mirror C++ names (`CPlayer extends CMover`) and keep `m_` Hungarian fields
(`m_nLevel`, `m_szName`, `m_vPos`). New non-mirroring code is plain `camelCase`. Files are
`<feature>.<layer>.ts`. Import order: node builtins → npm → `@flyff/*` → relative.

## World Server Game Loop

A 50ms tick drives `PlayerManager.tick(dt) → SpawnManager.tick(dt) → AIScheduler.tick(dt)` and
**must stay under 10ms**. No `await`, DB call, sync I/O, or heavy CPU work inside it — defer
to a queue or a Worker Thread. Broadcast per-zone, never across all players. Use `_dirty`
field sets and flush every 30s or on disconnect. Pool `PacketWriter`s and position vectors.

### Spawn notification — decoupled from JOIN

Two concerns that must stay split:

- **Materialization** (server-side): zone NPCs + monster spawn points are instantiated ONCE at
  world-server boot by `SpawnManager.bootstrap()`. They live in memory independent of any
  player. `dwObjIndex` MUST be a real `MI_*` from `resource/defineObj.h` (active block starts
  at line 1036) — the client's `CreateObj` → `GetMoverProp` null-derefs `OnAddObj`
  (`DPClient.cpp:1160`) on any value missing from its propMover table.
- **Client notification**: the ADD_OBJ snapshot for a player's zone is sent by
  `VicinityService.enterZone(charId)`, triggered from `MapKeyHandler` on the player's FIRST
  accepted `MAP_KEY` (one-shot via `CPlayer.m_vicinitySent`) — the point where Neuz has
  finished `WORLD_READINFO`/`ReadWorld`.

**Never send the NPC ADD_OBJ snapshot from `JoinHandler`.** It races the client's async world
load and desyncs the stream. JOIN sends only the self-spawn (WORLD_READINFO + the player's own
ADD_OBJ).

## Configuration Precedence

`loadConfig` (`packages/core/src/config/loader.ts`) merges last-wins:

```text
{} → config/default.json → config/<server>.json → config/*.yml → env overrides
```

Zod `.default()` only fills a key **no** layer provides. **Runtime config files override
schema defaults.** When changing a real default (spawn coords, ports, limits), update BOTH the
schema `.default()` AND the matching key in `config/<server>.json`, then restart — config is
read once at boot.

## Rules

Always-loaded rules in `.claude/rules/`: `01-core-standards`, `02-layer-architecture`,
`03-security`, `04-persistence`, `05-performance`, `06-testing`, `07-ipc`. Read them;
they are the enforceable detail behind the summaries above.

## Skills

Invoke a skill when its subject comes up — they hold the detail deliberately kept out of this
file. Full descriptions are listed in-session.

| Skill | When |
| --- | --- |
| `flyff-research` / `flyff-cpp-to-nodejs` | Finding and translating the C++ spec |
| `flyff-packet-protocol` | Packets, opcodes, PacketReader/Writer |
| `flyff-emulator-arch` / `flyff-multi-layer-arch` | Topology, zones, resource loading, DI |
| `flyff-game-systems` | Combat formulas, stats, AI, skills, drops, spawns |
| `flyff-database-layer` / `flyff-db-normalization` | Knex, repositories, schema shape, migrations |
| `flyff-state-persistence` | WAL journal, crash recovery, dupe prevention |
| `flyff-cache-layer` | `ICacheAdapter`, Redis, CF KV |
| `flyff-interserver-ipc` / `flyff-ipc-framework` | Cross-server messaging, handoff, `@flyff/ipc` internals |
| `flyff-security` | Auth, hashing, rate limiting, anti-cheat, validation |
| `flyff-testing-patterns` | `node:test` + tsx, in-memory SQLite, mock factories |
| `flyff-typescript-patterns` / `flyff-code-standards` | Strict TS, Zod, naming, TSDoc |
| `flyff-nodejs-patterns` | Async, EventEmitter, Worker Threads, Buffer, memory |
| `flyff-admin-form-ux` | Any form or editor in `packages/admin` |
| `flyff-agent-workflow` / `flyff-parallel-spawning` | Checkpointing, handoffs, phase gates, fan-out |
| `generic-eng-practices` | Language-agnostic review/style/workflow baseline |

## Session State

- `.claude/state/SESSION.md` — the current session's active goal and progress. Read it first
  when resuming; keep it current after each significant change.
- `.claude/state/PROGRESS.md` — the cross-agent ledger (module status, research findings,
  lessons learned, audit log). Every agent reads it at start and writes to it on completion.

Details and formats: skill `flyff-agent-workflow`.
