# node-flyff

A **Flyff (Fly For Fun) v19 MMORPG server emulator** written in TypeScript.

It speaks the authentic binary TCP protocol, so an unmodified retail v19 client
connects to it and plays — no client patching, no custom launcher. Login,
character select, and the game world all run as real servers.

[![CI](https://github.com/cmcsinc/node-flyff/actions/workflows/ci.yml/badge.svg)](https://github.com/cmcsinc/node-flyff/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
[![Node.js: 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9%2B-orange.svg)](https://pnpm.io)

> **Status: playable, incomplete, pre-1.0.** You can level a character through
> combat, quests, skills, parties, and trade, and fly on a board or broom. You
> cannot join a guild, marry, raise a pet, or enter a dungeon. See
> [**Feature Status**](docs/FEATURE-STATUS.md) for the honest breakdown.

---

## What this is

This project is a **port, not a reimplementation**. The original Flyff v19 C++
server source is the specification; every packet layout, damage formula, and AI
transition is translated from it rather than designed. That constraint is the
whole reason a retail client will talk to it.

What that gets you:

- **Authentic protocol** — `0x5E`-marker framing, CRC integrity, DWORD-prefixed
  strings. 112 client→server opcodes dispatched.
- **Real server topology** — separate login, cluster, and world processes talking
  over HMAC-signed IPC, the way the original does it.
- **Crash-proof persistence** — a hybrid WAL: every item, gold, and exp change
  hits a local SQLite journal in under 0.1 ms *before* the client is told it
  worked, then batch-flushes to the main database. Kill the process mid-trade and
  nothing duplicates or vanishes.
- **Modern engineering** — TypeScript strict mode with zero `any`, pure ESM, 19
  packages in an acyclic dependency graph, 2,494 tests on Node’s native runner,
  no test framework dependency.
- **A live-ops admin panel** — Next.js: resource editors, character operations,
  server supervisor, log streaming, client `.res` patching.

---

## Requirements

| | |
| --- | --- |
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| A retail Flyff v19 client | you must supply this yourself |
| Flyff v19 resource files | extracted from that client — see below |
| Redis | optional; falls back to an in-memory cache |
| PostgreSQL / MySQL | optional; SQLite is the default |

### Game resources are not included

This repository ships **no Flyff client files, assets, or game data**. Those are
copyrighted by Gala Lab Corp. and cannot be redistributed.

To run the server you need the resource files from a client you legitimately
possess — `propItem.txt`, `propMover.txt`, `propSkill.txt`, `character.inc`,
`WorldDialog.txt`, the quest and dialog `.inc` files, and the zone `.dyo`/`.rgn`
data. Extract them from your client's `.res` archives (`tools/res-reader.mjs`
reads that format) and place them under `packages/resources/raw/`, then run the
converter to produce the YAML the server loads:

```bash
pnpm --filter @flyff/resources convert
```

Without these files the world server will start but the world will be empty.

---

## Quick start

```bash
pnpm install
cp .env.example .env
```

Generate a real IPC secret and put it in `.env` — the servers refuse to trust
each other without a matching one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Seed the development database (this creates the schema and a test account):

```bash
pnpm --filter @flyff/login-server dev
```

The login server seeds on first boot. Then start the other two, each in its own
terminal:

```bash
pnpm server:login      # :23000  authentication
pnpm server:cluster    # :28000  character select
pnpm server:world      # :5400   gameplay
```

Or bring all three up under the supervisor:

```bash
pnpm sv:up
pnpm sv:status
pnpm sv:down
```

Point your client at the login server's address and connect.

> ⚠️ **The dev seed creates an account `test` / `test` at ADMINISTRATOR tier.**
> That is deliberate for local development and documented in the source. **Delete
> it before exposing this server to a network.** `scripts/seed-admin.mjs`
> similarly creates `admin` / `admin` when no GM account exists. See
> [SECURITY.md](SECURITY.md#deployment-hardening) for the full hardening list.

### Admin panel

```bash
pnpm admin        # dev server
```

The panel has no authentication assumptions baked in. Keep it on a private
network.

---

<!-- SECTIONS-BELOW -->

## Architecture

### Topology

```text
Flyff client ──► Login server   :23000   authenticate, deliver server list
                      │
                 @flyff/ipc — HMAC-SHA256 signed Redis pub/sub + internal TLS TCP
                      │
Flyff client ──► Cluster server :28000   character select / create
                      │
                 @flyff/ipc
                      │
Flyff client ──► World server   :5400    gameplay, combat, AI, zones
```

Only those three ports face players. Redis, the database, the IPC TCP listener,
the admin panel, and the supervisor daemon all belong on a private interface.

An alternative `@flyff/gateway` runs auth, select, and world in **one WebSocket
process** — convenient for local experiments, but it is a reduced parallel stack
that does not use the domain packages and is far behind the real servers. Do not
build on it.

### Packages

Nineteen packages in an acyclic dependency graph.

```text
# Shared infrastructure
core        packet protocol, opcodes, config loader, logger, cache, errors, event bus
ipc         HMAC-signed Redis pub/sub + TLS TCP between servers
database    Knex migrations (22), repositories (12), WAL journal
resources   propItem / propMover / propSkill / quest / dialog / zone loaders

# Shared world layers
entities    CPlayer, CMover, param model, buff manager, exp / vital math
world-core  player / zone / spawn managers, visibility, flight, quest-hooks seam

# Domain packages
combat      damage formulas, melee & ranged pipeline, monster AI FSM, duels
inventory   bag, equip, consume, drop, loot, trade, vending, enchant, repair
skills      skill cast and learn
quest       conditions, rewards, kill / patrol / time tracking
npc         dialog interpreter, shop, bank, buff NPC, targeting, speech
party       invite, roster, exp and item sharing
social      friends, campus (master–pupil mentoring)
mail        mailbox, attachments

# Entry points
login-server    auth + server list
cluster-server  character select / create
world-server    gameplay; composes the domain packages via compose.ts
gateway         unified WebSocket process (experimental)
admin           Next.js live-ops panel
```

### Layer discipline

Every feature follows the same path, and skipping a layer is a review rejection.

```text
Network → Handler → Service → Repository → Database
                 ↘ Manager (in-memory live state)
                 ↘ System  (per-tick simulation)
```

| Layer | Owns | Must not |
| --- | --- | --- |
| **Handler** | Parse packet fields, validate, call one service, write the reply | Touch the database or hold game rules |
| **Service** | Game rules, orchestration, WAL journaling | Call `socket.write()` or write SQL |
| **Repository** | Every Knex query | Hold game logic |
| **Manager** | In-memory live state | Persist anything |
| **System** | Per-tick simulation | Handle packets, or `await` in the tick |

Services reach handlers through a typed event bus, never by importing the socket.
Dependency injection is manual — everything is wired in each server's
`compose.ts`.

### Persistence

The MMO dilemma is that flushing every item change to the database melts it,
while batching them means a crash rolls players back and duplicates items. The
hybrid WAL resolves it:

1. A critical mutation writes to a local SQLite journal — under 0.1 ms — **before**
   the success packet goes out.
2. Dirty fields batch-flush to the main database every 30 seconds.
3. On boot, unreplayed journal entries are re-applied before the TCP listener
   opens. Payloads carry absolute state, so replay is idempotent.

---

## Development

```bash
pnpm -r build                  # build every package
pnpm -r test                   # 2,494 tests, Node's native runner
pnpm -r lint
pnpm -r exec tsc --noEmit
pnpm format
```

Tests use `node:test` with `tsx`. There is no Jest, Mocha, or Vitest, and adding
one will be declined. Test files live in `test/` at each package root, mirroring
`src/` — never inside `src/`.

Configuration merges last-wins:

```text
{} → config/default.json → config/<server>.json → config/*.yml → env vars
```

A Zod `.default()` only fills a key **no layer supplies**, so runtime config
files override schema defaults. Change both when changing a real default. Config
is read once at boot.

---

## Contributing

Contributions are welcome. Two documents matter before you start:

- [**CONTRIBUTING.md**](CONTRIBUTING.md) — workflow, standards, testing, PR
  checklist
- [**AGENTS.md**](AGENTS.md) — the same ground rules written for AI coding agents,
  plus a list of protocol traps that will otherwise cost you a week

The enforced per-domain rules live in [`.claude/rules/`](.claude/rules/).

**The one rule to internalize:** find the behaviour in the C++ source and
translate it. Do not design it. A guessed field width produces a client crash
that someone else has to find with a hex dump. If you cannot locate the C++,
say so and ask rather than approximating.

Good first contributions are the **quick wins** in
[Feature Status](docs/FEATURE-STATUS.md#quick-wins) — features that are already
implemented but never wired up, so each is a small fix with visible effect.

Found a security issue? See [SECURITY.md](SECURITY.md) — report it privately, not
as a public issue.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/FEATURE-STATUS.md](docs/FEATURE-STATUS.md) | What works, what partly works, what is missing |
| [docs/c++-fidelity-audit.md](docs/c++-fidelity-audit.md) | Known behavioural deviations from the original server |
| [docs/TESTING.md](docs/TESTING.md) | Testing approach and conventions |
| [CLAUDE.md](CLAUDE.md) | Full standards reference |
| [.claude/rules/](.claude/rules/) | Enforced rules by domain |
| `grep -rn "ponytail:" packages/*/src` | 164 line-level markers, each naming a deliberate simplification |

---

## License

[GNU Affero General Public License v3.0](LICENSE).

If you run a modified version of this software as a network service, the AGPL
requires you to offer its source to your users.

---

## Disclaimer

An unofficial, educational reimplementation of a game server. Not affiliated
with, endorsed by, or connected to Gala Lab Corp. (formerly Gravity Co.) or any
official Flyff product. All game content, assets, and trademarks belong to their
respective owners.

No game data, client files, or original server source are distributed here. You
must supply those yourself from a client you legitimately possess. Do not use
this software commercially or to compete with official game services.

