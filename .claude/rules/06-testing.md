# Testing Rules

All code must be testable and tested. These rules govern how tests are written and when they must exist.

## Test Runner

**Mandatory:** Node.js native `node:test` with `tsx`. **Never** use Jest, Mocha, Vitest, or any other test framework.

```ts
import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert/strict';
```

Run with: `tsx --test test/**/*.test.ts` (from package root)

## Test Directory Structure

**CRITICAL:** All test files MUST be in a `test/` directory at the package level, mirroring the `src/` structure. **NEVER** place `.test.ts` files in `src/`.

```
packages/core/
  src/
    net/
      PacketWriter.ts          ← Source code only
    cache/
      MemoryCache.ts
  test/
    net/
      PacketWriter.test.ts     ← Tests go here
    cache/
      MemoryCache.test.ts
    utils/
      mocks.ts
```

## One Test File Per Source File

Every `.ts` source file in `src/` must have a companion `.test.ts` in the corresponding `test/` directory:

```
src/handlers/auth.handler.ts      → test/handlers/auth.handler.test.ts
src/services/auth.service.ts      → test/services/auth.service.test.ts
src/repositories/account.repo.ts  → test/repositories/account.repo.test.ts
```

**Forbidden:** Creating `.test.ts` files in `src/` directories.
**Required:** Creating `.test.ts` files in `test/` directories with proper relative imports to `src/`.

If the companion test file does not exist in `test/`, the `post-tool-test-reminder` hook will flag it in `SESSION.md`.

## What Must Be Tested

| Component | What to test |
| --- | --- |
| **Handler** | Valid packet → correct response; invalid packet → `PacketError`; wrong session state → rejection |
| **Service** | Happy path + each error branch; WAL journal is called for mutations |
| **Repository** | CRUD via in-memory SQLite; transactions rollback on failure |
| **Utils/Math** | All formulas with boundary values and known game outputs |
| **IpcBus** | Messages are HMAC-signed; invalid signatures are rejected |

## Mock Standards

### Mock Sockets

```ts
function makeMockSocket(overrides = {}) {
  const written: Buffer[] = [];
  return {
    session: { state: SessionState.IN_WORLD, charId: 1, accountId: 1 },
    write: (buf: Buffer) => { written.push(buf); return true; },
    destroy: () => {},
    remoteAddress: '127.0.0.1',
    _written: written,
    ...overrides,
  };
}
```

### Mock DB (In-Memory SQLite)

```ts
before(async () => {
  db = Knex({ client: 'sqlite3', connection: ':memory:', useNullAsDefault: true });
  await db.migrate.latest({ directory: '../../migrations' });
});
after(() => db.destroy());
```

### Mock EventBus

```ts
const emitted: Array<[string, unknown]> = [];
const bus = { emit: (ev: string, data: unknown) => emitted.push([ev, data]) };
```

## Assert Standards

- Always use `node:assert/strict` — never the non-strict `node:assert`.
- Prefer `assert.deepEqual` for objects, `assert.equal` for primitives.
- Test error cases with `assert.rejects(async () => fn(), /pattern/)` or `assert.throws(() => fn(), /pattern/)`.

## Forbidden in Tests

- No real network calls — mock sockets and IPC.
- No real file I/O for DB — use in-memory SQLite.
- No `setTimeout` without `mock.timers` — use `mock.timers.enable()` and `mock.timers.tick()`.
- No `console.log` — use `assert` statements only.
