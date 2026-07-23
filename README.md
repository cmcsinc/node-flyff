# Flyff Node.js Server Emulator

> A modern, production-grade **Flyff (Fly For Fun) MMORPG server emulator** written in **TypeScript/Node.js**.
> Replicates the Login, Cluster, and World servers, communicating with real Flyff clients over TCP using the authentic binary packet protocol.

[![CI](https://github.com/your-org/nodejs-flyff/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/nodejs-flyff/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
[![Node.js: 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9%2B-orange.svg)](https://pnpm.io)

---

## ✨ Features

- **Modern TypeScript** — strict mode, pure ESM, zero `any`
- **Multi-Server Topology** — independent Login, Cluster, and World servers
- **Secure IPC** — HMAC-SHA256 signed Redis pub/sub + internal TLS TCP between servers
- **Crash-Proof Persistence** — Hybrid WAL pattern: SQLite WAL journal (0-latency) + Knex main DB sync
- **Multi-Database** — Knex.js supports SQLite3 (dev), PostgreSQL, and MySQL/MariaDB (production)
- **Clean Architecture** — strict `Handler → Service → Repository` separation
- **Domain packages** — world gameplay split into independent `@flyff/*` packages (combat, inventory, skills, quest, npc)
- **Fully Agentic** — specialized Claude sub-agents and lifecycle hooks for autonomous development

---

## 📁 Project Structure

The monorepo splits into three tiers: **shared infrastructure**, **domain packages**
(carved out of the world server), and **server entry points**.

```text
packages/
  # ── Shared infrastructure ──────────────────────────────────────────────
  core/               @flyff/core       — Packet protocol, constants, cache, logger, errors, event bus
  ipc/                @flyff/ipc        — Secure inter-server IPC (HMAC pub/sub + TLS TCP)
  database/           @flyff/database   — Knex migrations, repositories, WAL journal
  resources/          @flyff/resources  — propItem/propMover/propSkill loaders and parsers

  # ── Shared world layers ────────────────────────────────────────────────
  entities/           @flyff/entities   — CPlayer/CMover, slot/exp/vital math, authority constants
  world-core/         @flyff/world-core — Player/Zone/Spawn managers + QuestHooks seam

  # ── Domain packages (carved out of world-server) ───────────────────────
  combat/             @flyff/combat     — Damage formulas, melee/skill pipeline, AI FSM
  inventory/          @flyff/inventory  — Item/bag/equip/consume/drop/loot, ItemManager, ground items
  skills/             @flyff/skills     — Skill cast + learn services
  quest/              @flyff/quest      — Quest conditions/rewards, QuestTrackerSystem
  npc/                @flyff/npc        — Dialog/script/shop/bank/target/vicinity/mapKey services

  # ── Server entry points ────────────────────────────────────────────────
  login-server/       @flyff/login-server    — Auth + server list (port 23000)
  cluster-server/     @flyff/cluster-server  — Character select/create (port 38100)
  world-server/       @flyff/world-server    — Gameplay loop; composes the domain packages (port 38180)
  gateway/            @flyff/gateway    — Unified WebSocket server: auth + select + world in one process
tools/                Dev tools: packet sniffer, resource inspector
scripts/              Agent and dev helper scripts
.claude/
  agents/             Specialized sub-agents (architect, implementor, researcher, ...)
  hooks/              Lifecycle hooks (safety guard, checkpointing, test reminder)
  skills/             Context-aware knowledge skills
  state/SESSION.md    Persistent agent session checkpoint
```

> **Domain-package refactor:** the world server was decomposed from one monolith
> into focused `@flyff/*` domain packages (`combat`, `inventory`, `skills`,
> `quest`, `npc`) sitting on shared `entities` + `world-core` layers.
> `@flyff/world-server` now wires these together via its `compose.ts` root rather
> than owning the logic directly.

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | ≥ 20.0.0 |
| pnpm | ≥ 9.0.0 |
| Redis | ≥ 7 (optional for local dev — falls back to MemoryCache) |
| PostgreSQL / MySQL | (optional — SQLite3 used by default) |

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set DB_CLIENT, DATABASE_URL, REDIS_URL, IPC_SECRET
```

For **local development**, the defaults work out of the box:

```bash
DB_CLIENT=sqlite3
DB_FILENAME=./data/flyff_dev.sqlite3
IPC_SECRET=change-me-in-production
```

### 3. Run database migrations

```bash
pnpm --filter @flyff/database migrate
```

### 4. Start the servers

Open three terminals:

```bash
# Terminal 1 — Login Server
pnpm --filter @flyff/login-server dev

# Terminal 2 — Cluster Server
pnpm --filter @flyff/cluster-server dev

# Terminal 3 — World Server
pnpm --filter @flyff/world-server dev
```

Or with Docker Compose (Redis + PostgreSQL included):

```bash
docker compose up
```

#### Alternative: unified gateway (single process)

`@flyff/gateway` runs auth, character select, and world in **one WebSocket
process** — handy for local testing without the three-server split or Redis IPC:

```bash
pnpm --filter @flyff/gateway dev
```

---

## 🧪 Development Commands

```bash
# Build all packages
pnpm -r build

# Run all tests (Node.js native test runner)
pnpm -r test

# Lint all packages
pnpm -r lint

# Format all files
pnpm format

# Update session checkpoint
pnpm checkpoint --task="Description of what you did"
```

---

## 🏗 Architecture

### Server Topology

```text
Flyff Client ──► Login Server (:23000)   — authenticate, receive server list
                      │
                 @flyff/ipc (HMAC Redis pub/sub + internal TLS TCP)
                      │
Flyff Client ──► Cluster Server (:38100) — character select / create
                      │
                 @flyff/ipc
                      │
Flyff Client ──► World Server (:38180)   — gameplay, combat, AI, zones
```

### Layer Discipline

Every feature follows a strict hierarchy — **no skipping layers**:

| Layer | Owns | Must NOT |
| --- | --- | --- |
| **Handler** | Parse packets, validate input, call service | Access DB or implement game rules |
| **Service** | Business logic, game rules, emit events | Call `socket.write()` or write SQL |
| **Repository** | All Knex queries | Contain game logic |
| **Manager** | In-memory live state | Persist data |
| **System** | Per-tick game simulation | Handle packets |

### Persistence (Hybrid WAL)

To solve the "rollback vs. DB DDoS" MMORPG dilemma:

1. **Critical mutations** (items, gold, exp) → written synchronously to a local SQLite WAL journal (`world_X_journal.sqlite`) in `< 0.1ms`
2. **Main DB sync** → Knex batch-flushes dirty fields every 30 seconds
3. **Crash recovery** → on startup, replay any unprocessed journal entries

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

### 1. Fork & Branch

```bash
git checkout -b feat/your-feature-name
```

### 2. Follow Code Standards

- **TypeScript strict** — no `any`, no `@ts-ignore`
- **ESM only** — `import`/`export`, no `require()`
- **Handler → Service → Repository** — never skip layers
- **Zod** for all external input validation
- **pino** for logging — no `console.log`
- **node:test** for tests — no Jest/Mocha/Vitest
- **WAL-first** for any mutation of items, gold, or exp

See [`CLAUDE.md`](CLAUDE.md) for the full coding standards reference.

### 3. Write Tests

Every `.ts` source file must have a companion `.test.ts`.

```bash
pnpm -r test
```

### 4. Open a Pull Request

- Target: `main` branch
- Fill in the PR template
- Ensure CI passes (lint, build, test on SQLite + PostgreSQL)

---

## 📜 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
See the [`LICENSE`](LICENSE) file for details.

---

## ⚠️ Disclaimer

This project is for **educational and research purposes only**. It is not affiliated with, endorsed by, or connected to Gala Lab Corp. (formerly Gravity Co.) or any official Flyff product. All game content, assets, and trademarks belong to their respective owners. Do not use this software for commercial purposes or to replace official game services.
