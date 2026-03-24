# Testing Guide

This document describes the testing standards and practices for the Flyff Node.js emulator.

## Test Runner

We use **Node.js native test runner** (`node:test`) with **tsx** for TypeScript support.

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm test:core
pnpm test:ipc
pnpm test:database

# Run with coverage (experimental)
pnpm test:coverage

# Watch mode (requires tsx-watch)
pnpm test:watch
```

## Test Structure

### Test Directory Structure

Tests are organized in a `test/` directory at the package level, mirroring the `src/` structure:

```
packages/
  core/
    src/
      net/
        PacketWriter.ts
        PacketReader.ts
      cache/
        MemoryCache.ts
    test/
      net/
        PacketWriter.test.ts
        PacketReader.test.ts
      cache/
        MemoryCache.test.ts
      utils/
        mocks.ts
```

### One Test File Per Source File

Every `.ts` source file must have a companion `.test.ts` in the corresponding `test/` directory:

```
src/handlers/auth.handler.ts      → test/handlers/auth.handler.test.ts
src/services/auth.service.ts      → test/services/auth.service.test.ts
src/repositories/account.repo.ts  → test/repositories/account.repo.test.ts
```

### Test File Template

```ts
/**
 * Tests for path/to/source.ts
 */

import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { functionToTest } from './source.js';

describe('ComponentName', () => {
  it('does something specific', async () => {
    const input = { /* test data */ };
    const result = await functionToTest(input);

    assert.equal(result.expected, 'value');
  });
});
```

## Mock Utilities

Common mocks are available in `packages/core/test/utils/mocks.ts`:

```ts
import {
  createMockLogger,
  createMockSocket,
  createMockDb,
  createMockEventBus,
  createMockCache,
} from '@flyff/core/test/utils/mocks.js';
```

### Mock Socket

```ts
const socket = createMockSocket({
  remoteAddress: '192.168.1.1',
});

// Write packets to the socket
socket.write(packetBuffer);

// Assert what was written
const written = socket._written;
assert.equal(written.length, 1);
```

### Mock Logger

```ts
const logger = createMockLogger();
// Suppresses all output during tests
```

### Mock Database

```ts
const db = await createMockDb();
await db.migrate.latest({ directory: '../../migrations' });

// Run queries
const rows = await db('accounts').select('*');
```

### Mock EventBus

```ts
const bus = createMockEventBus();
await someService.doSomething();

// Assert events were emitted
const emitted = bus._emitted;
assert.equal(emitted[0][0], 'PLAYER_MOVED');
```

## What to Test

### Handlers
- Valid packet → correct response
- Invalid packet → `PacketError`
- Wrong session state → rejection

### Services
- Happy path + each error branch
- WAL journal is called for mutations
- Correct error messages

### Repositories
- CRUD operations via in-memory SQLite
- Transactions rollback on failure

### Utilities/Math
- All formulas with boundary values
- Known game outputs

## Assertions

Always use `node:assert/strict`:

```ts
import * as assert from 'node:assert/strict';

// Primitives
assert.equal(actual, expected);
assert.notEqual(actual, expected);

// Objects
assert.deepEqual(actual, expected);

// Booleans
assert.ok(value);
assert.ok(!condition);

# Errors
assert.rejects(async () => fn(), /expected error pattern/);
assert.throws(() => fn(), /expected error pattern/);
```

## Mocking

### Mock Timers

```ts
import { mock } from 'node:test';

mock.timers.enable({ now: 1000 });
mock.timers.tick(1000); // advance time
mock.timers.reset();
```

### Mock Functions

```ts
import { mock } from 'node:test';

const mockFn = mock.fn();
mockFn.mock.return(42);

assert.equal(mockFn.mock.calls.length, 1);
```

## Forbidden in Tests

- ❌ No real network calls — mock sockets and IPC
- ❌ No real file I/O for DB — use in-memory SQLite
- ❌ No `setTimeout` without `mock.timers`
- ❌ No `console.log` — use `assert` statements only

## Running Individual Tests

```bash
# Run a specific test file
tsx --test packages/core/test/net/PacketReader.test.ts

# Run only tests matching a pattern
tsx --test --test-name-pattern="Buffer.*drain" packages/core/test/**/*.test.ts
```

## Test Coverage

```bash
# Generate coverage report (requires Node 20+)
pnpm test:coverage
```

Coverage reports are generated in `coverage/` directory.

## CI/CD

Tests run automatically in CI on every push. The following must pass:

- All tests: `pnpm test`
- Linting: `pnpm lint`
- Type checking: `pnpm -r build` (must compile without errors)
