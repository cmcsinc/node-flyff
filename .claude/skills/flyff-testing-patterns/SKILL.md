---
name: flyff-testing-patterns
description: >
  Testing standards and patterns for the Flyff TypeScript server emulator. Use this skill when
  writing or running tests, setting up the Node.js native test runner, mocking database queries
  (SQLite in-memory), mocking sockets, or writing unit/integration tests for packet handlers,
  services, or game systems. Trigger on: "test", "testing", "mock", "assert", "coverage",
  "unit test", "integration test", "TDD", "spec", "node:test".
---

# Flyff Emulator — Testing Patterns

## Testing Framework

This project uses the **Node.js Native Test Runner** (`node:test`) combined with `tsx` for TypeScript execution. **DO NOT** use Jest, Mocha, or Vitest.

```json
// package.json (each package)
{
  "scripts": {
    "test": "tsx --test test/**/*.test.ts"
  }
}
```

```json
// Root package.json
{
  "scripts": {
    "test": "tsx --test packages/*/test/**/*.test.ts",
    "test:core": "tsx --test packages/core/test/**/*.test.ts"
  }
}
```

## ⚠️ CRITICAL: Test File Location

**ALL test files MUST be in `test/` directories, NOT in `src/`.**

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

**FORBIDDEN:** Creating `src/**/*.test.ts` files
**REQUIRED:** Creating `test/**/*.test.ts` files with relative imports to `src/`

---

## Basic Unit Test (Services/Math/Utils)

Use `node:test` and `node:assert/strict`:

```ts
// packages/core/test/utils/math.test.ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { distance3d } from '../../src/utils/math.js';

describe('Math Utils', () => {
  describe('distance3d()', () => {
    it('should calculate distance between two points', () => {
      const a = { x: 0, y: 0, z: 0 };
      const b = { x: 0, y: 3, z: 4 };
      assert.equal(distance3d(a, b), 5);
    });

    it('should return 0 for identical points', () => {
      const a = { x: 10, y: 20, z: 30 };
      assert.equal(distance3d(a, a), 0);
    });
  });
});
```

---

## Mocking Sockets & Packet Responses

When testing a Handler, you don't need a real TCP server. Create a mock socket and intercept `write`:

```ts
// packages/world-server/test/handlers/chat.handler.test.ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter, PacketReader } from '@flyff/core/net/index.js';
import { SNSP_PLAYER_CHAT } from '@flyff/core/constants/opcodes.js';
import { makeChatHandler } from '../../src/handlers/chat.handler.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';

function createMockSocket(player) {
  const written = [];
  return {
    session: { state: SessionState.IN_WORLD, player },
    write: (buf: Buffer) => { written.push(buf); return true; },
    destroy: () => {},
    _written: written, // expose for assertions
  };
}

describe('Chat Handler', () => {
  it('should broadcast chat message to zone', async () => {
    // 1. Setup mocks
    const player = { m_dwCharId: 1, m_szName: 'TestGuy', zone: { broadcastAround: () => {} } };
    let broadcastPacket = null;
    player.zone.broadcastAround = (pos, radius, packet) => {
      broadcastPacket = packet;
    };

    const socket = createMockSocket(player);
    const handler = makeChatHandler();

    // 2. Build incoming packet
    const w = new PacketWriter(SNSP_PLAYER_CHAT);
    w.writeString('Hello world!');
    const payload = w.build().slice(8); // strip header
    const r = new PacketReader(payload);

    // 3. Execute
    await handler(socket, r);

    // 4. Assert
    assert.ok(broadcastPacket !== null, 'Should have broadcasted');

    // Parse the outgoing broadcast packet
    const outReader = new PacketReader(broadcastPacket.slice(8));
    const senderId = outReader.readDword();
    const msg = outReader.readString();

    assert.equal(senderId, 1);
    assert.equal(msg, 'Hello world!');
  });
});
```

---

## Testing Database Repositories (In-Memory SQLite)

When testing repositories, swap the `Knex` connection to an in-memory SQLite database and run migrations before tests.

```ts
// packages/database/test/repositories/character.repo.test.ts
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import Knex from 'knex';
import { CharacterRepository } from '../../src/repositories/character.repo.js';

describe('CharacterRepository', () => {
  let db: Knex.Knex;
  let repo: CharacterRepository;

  before(async () => {
    // Setup in-memory SQLite for tests
    db = Knex({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });

    // Run migrations (assuming they are exported or using Knex migrate api)
    await db.migrate.latest({ directory: '../../src/migrations' });

    repo = new CharacterRepository(db);
  });

  after(async () => {
    await db.destroy();
  });

  it('should create and retrieve a character', async () => {
    // Insert prerequisite account
    const [accId] = await db('accounts').insert({
      username: 'test_user',
      password_hash: 'hash'
    }).returning('id');

    // Test the repository method
    const char = await repo.create(accId, 'Hero', 1, 0);
    assert.ok(char.id > 0);
    assert.equal(char.name, 'Hero');

    // Retrieve it
    const found = await repo.findById(char.id);
    assert.equal(found?.name, 'Hero');
  });
});
```

---

## Mocking Time for Game Loop Tests

Use `node:test`'s built-in `mock.timers`:

```ts
// packages/world-server/test/systems/buff.system.test.ts
import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { BuffManager } from '../../src/systems/buff.system.js';

describe('Buff System', () => {
  it('should remove buff after duration expires', () => {
    mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });

    const manager = new BuffManager();
    let expired = false;

    // Setup listener
    manager.on('expired', () => { expired = true; });

    // Add 5-second buff
    manager.add(1, 100, 1, 5000, {});
    assert.ok(manager.hasBuff(1, 100));

    // Advance time by 4s
    mock.timers.tick(4000);
    assert.equal(expired, false);
    assert.ok(manager.hasBuff(1, 100));

    // Advance time by 1.1s
    mock.timers.tick(1100);
    assert.equal(expired, true);
    assert.equal(manager.hasBuff(1, 100), false);

    mock.timers.reset();
  });
});
```

---

## Testing IPC (Mocking CacheAdapter)

```ts
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { IpcBus } from '@flyff/ipc/index.js';

describe('IpcBus', () => {
  it('should publish signed messages', async () => {
    const published = [];
    const mockCache = {
      publish: async (channel, msg) => { published.push({ channel, msg }); }
    };

    const bus = new IpcBus(mockCache, 'test_secret', 'server_1');
    await bus.publish('test_channel', { hello: 'world' });

    assert.equal(published.length, 1);
    assert.equal(published[0].channel, 'test_channel');

    const envelope = JSON.parse(published[0].msg);
    assert.equal(envelope.from, 'server_1');
    assert.equal(envelope.payload.hello, 'world');
    assert.ok(envelope.sig, 'Message must be signed');
  });
});
```
