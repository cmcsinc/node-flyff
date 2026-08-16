# Testing Rules

All code must be testable and tested. Code samples and mock factories live in the
`flyff-testing-patterns` skill — this file is the enforceable rule set.

## Test Runner

**Mandatory:** Node.js native `node:test` with `tsx`. **Never** Jest, Mocha, Vitest, or any
other framework.

```ts
import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert/strict';
```

Every package's `package.json` must use `"test": "tsx --test test/**/*.test.ts"`; the root uses
`"tsx --test packages/*/test/**/*.test.ts"`.

## Test File Location — Cardinal Rule

**NEVER create `.test.ts` files under `src/`.** Tests live in a package-level `test/` directory
mirroring `src/`, and import across with a relative path:

```text
src/handlers/auth.handler.ts     → test/handlers/auth.handler.test.ts
src/services/auth.service.ts     → test/services/auth.service.test.ts
src/repositories/account.repo.ts → test/repositories/account.repo.test.ts
src/utils/math.ts                → test/utils/math.test.ts
```

```ts
// test/net/PacketWriter.test.ts  ← correct location
import { PacketWriter } from '../../src/net/PacketWriter';  // ← import from src/, never './'
```

`src/` holds `.ts` source only — no tests, no committed `.js`/`.d.ts` build output. Pre-commit
hooks reject `src/**/*.test.ts`, and CI fails if any are found. The split keeps `src/` clean,
keeps test code out of the production bundle, and lets the runner ignore `src/` entirely.

Every `.ts` file in `src/` should have a companion `.test.ts` in `test/`. If it is missing, the
`post-tool-test-reminder` hook flags it in `SESSION.md`.

When migrating a legacy co-located test: move the file preserving its subpath, rewrite
`./File` imports to `../../src/path/File`, fix the `package.json` glob, confirm it still
passes, then delete the original.

## What Must Be Tested

| Component | What to test |
| --- | --- |
| **Handler** | Valid packet → correct response; invalid packet → `PacketError`; wrong session state → rejection |
| **Service** | Happy path + each error branch; WAL journal is called for mutations |
| **Repository** | CRUD via in-memory SQLite; transactions rollback on failure |
| **Utils/Math** | All formulas with boundary values and known game outputs |
| **IpcBus** | Messages are HMAC-signed; invalid signatures are rejected |

## Mocks

Never touch real infrastructure. Mock sockets expose a `_written: Buffer[]` array and a
`session` stub; databases use `Knex({ client: 'sqlite3', connection: ':memory:' })` with
`migrate.latest()` in `before()` and `destroy()` in `after()`; the EventBus is a `{ emit }`
stub that pushes to an array. Ready-made factories: skill `flyff-testing-patterns`.

## Assert Standards

- Always `node:assert/strict` — never the non-strict `node:assert`.
- `assert.deepEqual` for objects, `assert.equal` for primitives.
- Error cases via `assert.rejects(async () => fn(), /pattern/)` or `assert.throws(...)`.

## Forbidden in Tests

- No real network calls — mock sockets and IPC.
- No real file I/O for the DB — in-memory SQLite only.
- No `setTimeout` without `mock.timers` — use `mock.timers.enable()` / `.tick()` / `.reset()`.
- No `console.log` — assertions only.
