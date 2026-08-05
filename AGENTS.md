# AGENTS.md — instructions for AI coding agents

This file is the machine-facing entry point for this repository. Human
contributors should read [`CONTRIBUTING.md`](CONTRIBUTING.md) instead; it covers
the same rules in prose.

Read this file completely before your first tool call. Then read
[`CLAUDE.md`](CLAUDE.md) for the full standards reference and
[`.claude/rules/`](.claude/rules/) for the enforced per-domain rules.

---

## 0. What this repository is

A **Flyff (Fly For Fun) v19 MMORPG server emulator** in TypeScript. It speaks the
authentic binary TCP protocol to unmodified retail Flyff clients. Three server
processes (login, cluster, world) plus an admin panel, in a pnpm ESM monorepo of
19 packages.

**It is a port of a working C++ server, not a greenfield project.** This single
fact should change how you behave more than anything else in this file.

---

## 1. The prime directive: never invent, always port

The C++ source in `game/source/` is the specification. Every packet layout,
damage formula, drop table rule, AI state transition, and item flag already
exists there in working form.

**Before writing any code that implements game behaviour:**

1. Find the C++ function. `grep -rn "OnMoveItem" game/source/` and read it.
2. Translate it — field order, integer widths, rounding mode, and position in
   the pipeline all matter.
3. Cite the file and line in your commit message or PR body.

**Rules:**

- If the C++ and the existing TypeScript disagree, the **C++ is correct**. Fix
  the TypeScript. Do not "fix" your reading of the C++.
- If you cannot port something faithfully because a downstream system does not
  exist yet, leave a `// ponytail: <what is unported and why>` comment and
  surface it to the user. There are ~164 of these markers across 82 files; they
  are the project's line-level gap inventory (`grep -rn "ponytail:" packages/*/src`).
- If you cannot find the C++ for something, **say so and ask**. Do not
  best-effort a packet structure. A guessed field width produces a client crash
  that costs a human a week with a hex dump.
- Only the in-repo `game/source/` counts as the reference. Do not pull in
  external Flyff source trees; they are different versions and will mislead you.

A plausible-looking invented formula is worse than no code, because it looks
finished.

---

## 2. Authority: who decides a thing is done

**The user is the only source of truth for whether a feature works.**

- Never mark a task complete, ✅, fixed, resolved, or working — in a todo list,
  a state file, a commit message, a PR body, or chat — unless the user said so.
- Say "implemented", "tests pass on my machine", or "ready for you to test".
  Never "fixed" or "works".
- A green test suite proves your checks pass. It does not prove the feature works
  against a real client, because the client is the part you cannot mock.
- An open task means the feature is **not working yet**. Keep iterating on it
  until the user says otherwise. Do not park it as done-pending and move on.

`✅` inside `.claude/state/MISSING-FEATURES.md` means "passes this device's
checks", never "user-confirmed". Two entries carry an explicit
`USER-CONFIRMED` label; those are the only ones that mean it.

---

## 3. Before you touch anything

```bash
# 1. Read the current state
cat .claude/state/SESSION.md          # what the last session was doing
cat .claude/state/MISSING-FEATURES.md # feature-by-feature status, 25 sections
cat docs/FEATURE-STATUS.md            # the public-facing summary

# 2. Branch. Never commit to master.
git checkout master && git pull
git checkout -b feat/short-description
```

Also worth reading before a change in an unfamiliar area:

- `docs/c++-fidelity-audit.md` — known TS↔C++ behavioural deviations
- `.claude/rules/0*.md` — the enforced rules, by domain

---

## 4. Architecture you must respect

### Layers — skipping one is a review rejection

```
Network → Handler → Service → Repository → Database
                 ↘ Manager (in-memory live state)
                 ↘ System  (per-tick simulation)
```

| Layer | Owns | Forbidden |
| --- | --- | --- |
| `*.handler.ts` | Parse packet fields, validate, call **exactly one** service, write the reply | Importing knex or a repo; holding game rules; calling two services |
| `*.service.ts` | Game rules, orchestration across repos, WAL journaling, `bus.emit()` | Importing `net.Socket`; calling `socket.write()`; raw SQL; reading `process.env` |
| `*.repo.ts` | Every Knex query; returns plain typed rows | Game logic; emitting events; string-interpolated SQL |
| `*.manager.ts` | In-memory live state, O(1) lookup, spatial queries | Writing to the DB; packet logic |
| `*.system.ts` | Per-tick simulation | `await` inside the tick; socket writes |

Services reach handlers through the EventBus, not by importing the socket.
Dependency injection is manual: everything is wired in each server's
`compose.ts` via `init({ dep })`. Never create an import-time global singleton.

### Package layout

```
core       packet protocol, opcodes, config, logger, cache, errors, event bus
ipc        HMAC-signed Redis pub/sub + TLS TCP between servers
database   Knex migrations, repositories, WAL journal
resources  propItem/propMover/propSkill loaders and parsers
entities   CPlayer / CMover, slot / exp / vital math
world-core Player / Zone / Spawn managers, QuestHooks seam
combat inventory skills quest npc party social mail   domain packages
login-server cluster-server world-server gateway admin   entry points
```

Dependencies form an acyclic DAG in that order. A domain package must not
import a server; `database` must not import `core` (it breaks `rootDir` — it
carries a local logger interface instead).

---

## 5. Non-negotiable rules

### Security

Every value from a `PacketReader` is hostile.

- `Validate.slot()` / `Validate.name()` / `Validate.dword()` / `Validate.pos()`
  on every field before use. An unchecked slot index is an out-of-bounds write
  into another player's inventory.
- Guard session state before any in-world operation:
  `assert(session.state === SessionState.IN_WORLD)`.
- **`appendJournal()` synchronously BEFORE the success packet** for any change to
  items, gold, or exp. Crash after the reply but before the journal write is an
  item dupe. Journal after validation, before persistence.
- All stats computed server-side. Client-sent HP/ATK/DEF is a lie by definition.
- Knex builders or `?` bindings. Never interpolate into `db.raw`.
- Rate-limit any handler the client can spam.

Full checklist: `.claude/rules/03-security.md`.

### The 50 ms tick

The whole world tick must finish under 10 ms.

- No `await`, no DB call, no sync I/O, no large allocation, no JSON parse inside
  the tick. Push to a queue and drain outside.
- Broadcast per zone (`zone.broadcastAround`), never over all players.
- Dirty flags: `player._dirty.add('m_nGold')`, so the 30 s flush writes a partial
  UPDATE.
- Clear every timer and remove from every manager on disconnect. Do not rely on GC.

### Database

- Any new 1:N collection gets its own table. Never a JSON column or packed
  string on the owner row — even when the C++ serializes it that way, because
  that is a flat-file storage artifact, not a schema.
- Container state lives on the container (`inventory.gold`, `bank.bank_pass`),
  never on `characters` / `accounts`.
- **A migration must be registered in three places** or the dev database will
  never see it: the Knex migration file, the `MIGRATIONS` array in
  `packages/login-server/src/seed.ts`, and `packages/admin/lib/migrate.ts`.

### Config

`loadConfig` merges last-wins: `{}` → `config/default.json` →
`config/<server>.json` → `config/*.yml` → env. A Zod `.default()` only fills a
key **no layer supplies**, so **runtime config files override schema defaults.**
When changing a real default, change both the schema and the matching
`config/<server>.json` key. Config is read once at boot — restart to apply.

### TypeScript

Strict mode, zero `any`, ESM only, extensionless imports, `import type` for
type-only imports, functions ≤ ~50 lines, files ≤ ~300 lines, `pino` not
`console.log`, errors extend `FlyffError`, Zod at every external boundary.

Entity classes and fields mirror the C++ (`CPlayer`, `m_nLevel`, `m_vPos`) so
the port stays cross-referenceable. Code mirroring nothing uses `camelCase`.

---

## 6. Testing

`node:test` with `tsx`. **No Jest, Mocha, or Vitest** — do not add one.

Tests live in `test/` at the package root, mirroring `src/`. **Never create a
`.test.ts` inside `src/`.**

```
packages/combat/src/combat/formulas.ts
  → packages/combat/test/combat/formulas.test.ts
  → import { x } from '../../src/combat/formulas';
```

```bash
pnpm -r test                          # everything
pnpm --filter @flyff/combat test      # one package
```

Use `node:assert/strict`. Mock the socket, the EventBus, and the DB (in-memory
SQLite). No real network or filesystem.

`mock.timers.enable()` is global state — pair it with `afterEach(reset)` or the
next file inherits frozen time.

**Never `.skip()` a failing test or weaken an assertion to reach green.** Fix the
code. If the test itself encodes wrong C++ behaviour, fix the test and say why in
the PR.

---

## 7. Verify before you report

```bash
pnpm -r exec tsc --noEmit    # must be clean
pnpm -r lint                 # must be clean
pnpm -r test                 # must be 0 failures
```

Run all three. Report the actual result. If something fails, say so and paste the
output — do not describe work as finished with a red suite behind it.

Clean up temporary files you created while verifying.

---

## 8. Sub-agents

Delegate fan-out work: reading many files, sweeping for a pattern across
packages, auditing several subsystems in parallel. Keep only the findings in the
main context.

- Spawn parallel agents in a **single message** with multiple tool calls, or they
  run serially.
- Limits: max nesting depth 3, max 5 concurrent per parent.
- No agent-to-agent communication; coordinate through the parent.
- Never let two agents edit the same file concurrently — serialize through the
  parent.
- One agent, one responsibility. A research agent does not write code; a review
  agent does not fix what it finds.

The specialized agent definitions live in `.claude/agents/`.

---

## 9. Things that will bite you

Hard-won specifics that are not guessable from the code:

| Trap | Reality |
| --- | --- |
| `CAr` serialization widths | `CAr::operator<<` writes `sizeof(static type)`. A `BYTE` is one byte and never widens. Get one field wrong and the client desyncs into a null-deref at `item.h:936`. |
| NPC spawn snapshot on JOIN | Never send the NPC `ADD_OBJ` batch from `JoinHandler` — it races the client's async world load. Send it from the first accepted `MAP_KEY`. |
| `dwObjIndex` on movers | Must be a real `MI_*` from `defineObj.h`. Any value missing from the client's propMover table null-derefs `OnAddObj`. |
| Same-world teleport | Use `SETPOS` (`0x0010`). `REPLACE` nulls `g_pPlayer` on the client. |
| Broadcast framing | `socket.write` needs `framePacket()` applied at the write boundary, not earlier. |
| Dev database | Seeded by `seed.ts`, not `knex migrate`. A migration missing from the `MIGRATIONS` array is invisible locally. |
| `resources` package | Imports from `dist/`. Rebuild after changing `src/` or `data/`. |
| Echo-driven client UI | `MOVEITEM`, `DROPITEM`, and item consumption need their `UPDATE_ITEM` echo, or the client shows ghost icons. `UPDATE_ITEM.nId` is the stable objid, not the slot. |
| Config defaults | `config/*.json` beats Zod `.default()`. Change both. |

More of these are recorded as memories and in `docs/`. When you discover a new
one, write it down — that is the highest-leverage thing you can leave behind.

---

## 10. Do not commit

- Flyff client binaries, `.res` archives, or extracted game assets
- Decompiled binaries or the original C++ server source
- Real credentials, tokens, private IPs, or absolute paths containing a username
- `data/`, `dist/`, `*.sqlite3`, `logs/`, `.env`

`.gitignore` covers these. Check `git status` before committing; an unanchored
pattern has swallowed a real source directory before (`logs` vs `/logs/`).

---

## 11. Reporting back

State what you changed, which files, what you verified, and what you did **not**
verify. Name the C++ source you ported from. If you left a `ponytail:` marker,
say what is still unported.

Do not claim a feature is fixed. That is the user's call, and only after they
test it on a real client.
