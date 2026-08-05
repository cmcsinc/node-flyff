# Contributing to node-flyff

Thanks for your interest. This document is the short version of the rules; the
long version lives in [`CLAUDE.md`](CLAUDE.md) and [`.claude/rules/`](.claude/rules/).

If you are an AI agent, read [`AGENTS.md`](AGENTS.md) instead — it is the
machine-facing entry point.

---

## The one rule that matters most

**This project is a port, not new development.**

Every feature, formula, packet layout, and game rule already has a working C++
implementation in `game/source/`. That C++ is the specification.

- Read the C++ before writing code. Find the function, translate it.
- Match field order, integer widths, rounding, and pipeline position exactly.
- If existing TypeScript contradicts the C++, the C++ is right — fix the TS.
- If you genuinely cannot port 1:1, leave a `// ponytail:` comment naming the
  unported part, and say so in your PR. Never silently invent behaviour.

A "reasonable guess" at a packet layout or damage formula is a bug that will
take someone else a week to find with a hex dump. Don't guess.

---

## Getting set up

```bash
pnpm install
cp .env.example .env          # defaults work for local SQLite dev
pnpm --filter @flyff/database migrate
```

Run the three servers in separate terminals (see [README](README.md#4-start-the-servers)),
or the unified gateway for quick local testing.

---

## Workflow

1. **Branch first.** Never commit to `master`.
   ```bash
   git checkout master && git pull
   git checkout -b feat/short-description
   ```
   Branch name is `<type>/<kebab-description>` using the commit types below.

2. **Research.** Locate the C++ implementation. Record opcodes, struct layouts,
   and formulas in your PR description or in `docs/`.

3. **Implement bottom-up.** Migration → repository → service → handler.

4. **Test.** Every source file gets a companion test. See [Testing](#testing).

5. **Verify.**
   ```bash
   pnpm -r exec tsc --noEmit
   pnpm -r lint
   pnpm -r test
   ```
   All three must be green before you open a PR.

6. **Open a PR** against `master`. Fill in the template. Do not merge your own PR.

### Commit messages

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
Scope is optional and encouraged: `fix(combat): ...`.

---

## Architecture rules

### Layer discipline — never skip a layer

```
Network → Handler → Service → Repository → Database
                 ↘ Manager (in-memory live state)
                 ↘ System  (per-tick simulation)
```

| Layer | Owns | Must NOT |
| --- | --- | --- |
| **Handler** (`*.handler.ts`) | Parse packet fields, validate, call **one** service, write the reply | Touch the DB, hold game rules |
| **Service** (`*.service.ts`) | Game rules, orchestration, WAL journaling | Call `socket.write()`, write SQL |
| **Repository** (`*.repo.ts`) | All Knex queries, return plain typed rows | Hold game logic |
| **Manager** (`*.manager.ts`) | In-memory live state, O(1) lookups | Persist anything |
| **System** (`*.system.ts`) | Per-tick simulation | Handle packets, `await` in the tick |

Services talk back to handlers via the EventBus (`bus.emit(EV.*)`), never by
importing the socket.

Dependency injection is manual: wire singletons in each server's `compose.ts`
using the `init({ dep })` factory pattern. No import-time global singletons.

### Code standards

- **TypeScript strict.** No `any`. Use `unknown` plus narrowing.
- **No `@ts-ignore` / `as X`** without a comment explaining why it is unavoidable.
- **ESM only.** No `require()`, no `.cjs`. Extensionless imports.
- **Max ~50 lines per function, ~300 lines per file.** Split, don't sprawl.
- **`pino` for logging.** Never `console.log` outside scripts. Always pass a
  structured context object first: `logger.info({ charId }, 'msg')`.
- **Errors extend `FlyffError`** (`PacketError`, `AuthError`, `GameError`).
  Never throw bare `Error`.
- **Zod validates all external input** — packets, env config, IPC payloads.
- Entity classes mirror the C++ names and Hungarian fields (`CPlayer`,
  `m_nLevel`, `m_vPos`) so the port stays cross-referenceable. New code that
  mirrors nothing uses plain `camelCase`.

### Security — non-negotiable

Every field read from a `PacketReader` is hostile until validated.

- Bounds-check every slot index, range-check every number, length-bound every string.
- Guard session state (`session.state === SessionState.IN_WORLD`) before touching
  in-world data.
- **Journal before you acknowledge.** Any mutation of items, gold, or exp calls
  `appendJournal()` synchronously *before* the success packet goes out —
  otherwise a crash on the next line duplicates an item.
- All stats are computed server-side. Never trust client-sent HP, ATK, or DEF.
- Knex query builders or `?` bindings only. Never interpolate into `db.raw`.
- Rate-limit any handler the client can spam.

The full checklist is in [`.claude/rules/03-security.md`](.claude/rules/03-security.md).
Report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md).

### Performance — the 50 ms tick is sacred

The whole world tick must finish in under 10 ms.

- No `await`, no DB call, no sync I/O, no heavy CPU work inside the tick. Queue it.
- Broadcast per zone (`zone.broadcastAround(...)`), never across all players.
- Use dirty flags (`player._dirty.add('m_nGold')`) so the 30 s flush writes a
  partial UPDATE, not the whole row.
- Clear every timer on disconnect; remove the entity from its manager. Don't
  wait for GC.

### Database

- New 1:N collections get their own table. **Never** a JSON column or packed
  string on the owner row — even when the C++ serializes it that way, because
  that is a flat-file storage detail, not a schema.
- A container's own state lives on the container table (`inventory.gold`,
  `bank.bank_pass`), not on `characters` / `accounts`.
- A new migration must be registered in **three** places or the dev DB never
  sees it: the Knex migration file, the `MIGRATIONS` array in
  `packages/login-server/src/seed.ts`, and `packages/admin/lib/migrate.ts`.

---

## Testing

Node's native runner only — `node:test` with `tsx`. No Jest, Mocha, or Vitest.

Tests live in `test/` at the package root, mirroring `src/`. **Never** put a
`.test.ts` file inside `src/`.

```
packages/combat/src/combat/formulas.ts  →  packages/combat/test/combat/formulas.test.ts
```

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { computeDamage } from '../../src/combat/formulas';
```

Use `node:assert/strict`, never the loose variant. Mock sockets, IPC, and the
DB (in-memory SQLite). No real network or filesystem in tests.

What to cover: handlers (valid → reply, invalid → `PacketError`, wrong session
state → rejection), services (happy path plus every error branch, and that the
WAL journal was called), repositories (CRUD against in-memory SQLite,
transaction rollback), and every formula at its boundary values.

Never `.skip()` a failing test or weaken an assertion to get green. Fix the code.

---

## Pull requests

Before requesting review:

- [ ] `pnpm -r exec tsc --noEmit` clean
- [ ] `pnpm -r lint` clean
- [ ] `pnpm -r test` green (0 failures)
- [ ] Companion test file exists for every new source file
- [ ] No `any`, no `console.log`, no skipped validation
- [ ] C++ source cited for any ported formula, packet, or rule
- [ ] Any unavoidable simplification marked with `// ponytail:`
- [ ] No secrets, credentials, or copyrighted game data added

In the PR body, say what you ported, from which C++ file and line, and what you
verified. If you tested against a real client, say what you saw.

**"Done" is the maintainer's word, not yours.** A green test suite means your
checks pass — it does not mean the feature works in-game. Describe what you
verified and let the maintainer confirm.

---

## Reporting bugs

Use the issue template. For a packet or protocol bug, include the hex dump, the
opcode, and which client build you ran. That turns a week of guessing into an
afternoon.

---

## Legal

Contributions are licensed under AGPL-3.0, matching the project.

Do not commit Flyff client files, game resources, decompiled binaries, or
original C++ server source. The build reads those from paths you supply locally;
they are gitignored for a reason. A PR that adds them will be closed.
