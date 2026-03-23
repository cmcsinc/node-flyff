---
name: flyff-code-standards
description: >
  Coding standards, naming conventions, file/folder structure, TSDoc, ESLint+TypeScript config,
  and style rules for the Flyff TypeScript emulator project. Always use this skill when
  writing new files, refactoring existing ones, reviewing code style, setting up linting,
  naming variables/classes/functions, organising imports, or discussing what the "right"
  way to write something is in this codebase. Trigger on: "naming convention", "code style",
  "how should I name", "folder structure", "project layout", "eslint", "tsdoc", "jsdoc",
  "comments", "code review", "best practice", "clean code", "standard", "convention",
  "tsconfig", "typescript config", "strict mode".
---

# Flyff Emulator — Code Standards

## Language & Runtime

- **TypeScript** — strict mode, ESM only (`.ts` files, compiled to `.js` in `dist/`)
- **Node.js 20 LTS** minimum
- `"type": "module"` in every `package.json`
- File extensions: `.ts` for source, `.test.ts` for tests, `.d.ts` for declarations
- Dev runner: `tsx` (ESM-native TypeScript executor, no compile step needed)
- Build: `tsc` → `dist/`

---

## TypeScript Config (Root `tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "esModuleInterop": false,
    "skipLibCheck": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Each package extends a root `tsconfig.base.json` in the workspace root.

---

## Folder / File Structure

```
packages/
  core/
    src/
      net/           ← PacketReader.ts, PacketWriter.ts, PacketBuffer.ts, LSFRCipher.ts
      constants/     ← opcodes.ts, objectTypes.ts, jobIds.ts, itemKinds.ts
      utils/         ← math.ts, time.ts, bitflags.ts
      errors/        ← FlyffError.ts, PacketError.ts, AuthError.ts
      cache/         ← ICacheAdapter.ts, RedisCache.ts, CloudflareCache.ts, MemoryCache.ts
      ipc/           ← channels.ts, schemas.ts
      config.ts      ← Zod env config
      logger.ts
      eventBus.ts
    index.ts         ← re-exports public API
  ipc/
    src/
      IpcBus.ts
      IpcServer.ts
      IpcClient.ts
      signing.ts
      circuit.ts
      schemas/       ← playerEnter.schema.ts, serverStatus.schema.ts …
    index.ts
  login-server/
    src/
      handlers/      ← auth.handler.ts, world.handler.ts
      services/      ← auth.service.ts, token.service.ts
      compose.ts
      index.ts
  cluster-server/
    src/
      handlers/
      services/
      compose.ts
      index.ts
  world-server/
    src/
      handlers/
      services/
      managers/      ← zone.manager.ts, object.manager.ts, spawn.manager.ts
      entities/      ← player.ts, mover.ts, npc.ts, item.ts
      systems/       ← combat.system.ts, ai.system.ts, movement.system.ts
      ipc/           ← clusterListener.ts
      compose.ts
      index.ts
  database/
    src/
      repositories/  ← account.repo.ts, character.repo.ts, inventory.repo.ts
      migrations/    ← 001_initial.ts, 002_skills.ts …
      db.ts          ← Knex factory (SQLite3 / PG / MySQL)
      migrate.ts
    index.ts
resources/
  src/
    loaders/         ← propItem.loader.ts, propMover.loader.ts
    parsers/         ← defineFile.parser.ts, propFile.parser.ts
  data/              ← .txt / .inc resource files go here
tools/
  packet-sniffer/
  resource-inspector/
```

---

## Naming Conventions

### Files
| What | Pattern | Example |
|---|---|---|
| Handler | `<feature>.handler.ts` | `auth.handler.ts` |
| Service | `<feature>.service.ts` | `token.service.ts` |
| Repository | `<entity>.repo.ts` | `character.repo.ts` |
| Manager | `<domain>.manager.ts` | `zone.manager.ts` |
| System | `<domain>.system.ts` | `combat.system.ts` |
| Entity class | `<name>.ts` | `player.ts` |
| Constants | `<domain>.ts` | `opcodes.ts` |
| Interface | `I<Name>.ts` | `ICacheAdapter.ts` |
| Schema | `<name>.schema.ts` | `playerEnter.schema.ts` |
| Tests | `<file>.test.ts` | `auth.service.test.ts` |

### Variables & Functions
```ts
// Variables — camelCase
const playerName = 'Hero';
let currentHp = 100;

// Constants — SCREAMING_SNAKE or camelCase for simple values
const MAX_INVEN_SLOTS = 42 as const;
const TICK_MS = 50 as const;

// Preserve Flyff C++ naming for game data fields (m_ prefix, Hungarian notation)
player.m_nLevel   // matches C++ source — easier cross-reference
player.m_szName
player.m_vPos
```

### Classes & Interfaces

```ts
// PascalCase, no abbreviations
class PacketReader {}
class ZoneManager {}
class AuthService {}
class CharacterRepository {}

// Interfaces — I prefix
interface ICacheAdapter {}
interface IpcMessage<T> {}
interface ICharacterRow {}

// Entities mirror C++ names for cross-reference
class CPlayer extends CMover {}
class CCtrl extends CMover {}  // NPC/Monster
```

### Constants / Enums
```ts
// Freeze plain objects for enums (runtime + type safe)
export const SessionState = Object.freeze({
  CONNECTED:      0,
  AUTHENTICATING: 1,
  IN_LOBBY:       2,
  IN_WORLD:       3,
  DISCONNECTED:   4,
} as const);
export type SessionState = typeof SessionState[keyof typeof SessionState];

// Or TypeScript const enum (inlined by compiler, no runtime object)
export const enum PacketState { HEADER, BODY }

// Opcode constants: preserve C++ SNSP naming
export const SNSP_LOGIN_CERTIFY = 0xFC03 as const;
export const SNSP_CHAR_SELECT   = 0xFB0B as const;
```

---

## Import Order

1. Node built-ins
2. External npm packages
3. Internal `@flyff/*` packages
4. Relative imports (deep → shallow)

```ts
// 1. Built-ins
import net from 'node:net';
import crypto from 'node:crypto';

// 2. External
import { Knex } from 'knex';
import Redis from 'ioredis';
import { z } from 'zod';

// 3. Internal packages
import { PacketReader, PacketWriter } from '@flyff/core';
import { SNSP_LOGIN_CERTIFY } from '@flyff/core/constants/opcodes.js';
import { IpcBus } from '@flyff/ipc';

// 4. Relative
import { AuthService } from '../services/auth.service.js';
import { logger } from './logger.js';
```

Note: Use `node:` prefix for built-ins. Keep `.js` extension in imports even for `.ts` source files (Node16 ESM resolution requirement).

---

## TSDoc Standards

Every exported function, class, interface, and constant gets a TSDoc block:

```ts
/**
 * Reads a Flyff-format length-prefixed ASCII string from the buffer.
 *
 * @param buf - The raw packet buffer.
 * @param offset - Starting byte offset.
 * @returns Object with parsed value and next offset position.
 */
export function readFlyffString(buf: Buffer, offset: number): { value: string; newOffset: number } { … }

/**
 * Character row returned from the database.
 */
export interface ICharacterRow {
  id: number;
  name: string;
  level: number;
  job: number;
}

/**
 * Loads all characters for an account.
 *
 * @param accountId - The account's database ID.
 */
export async function getCharacters(accountId: number): Promise<ICharacterRow[]> { … }
```

For Flyff-specific fields that mirror C++ source, add a `@see` tag:
```ts
/** @see CMover::m_nHP in FlyFF source */
m_nHP = 0;
```

---

## Error Handling

```ts
// packages/core/src/errors/FlyffError.ts
export class FlyffError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'FlyffError';
  }
}

export class PacketError extends FlyffError {}
export class AuthError   extends FlyffError {}
export class GameError   extends FlyffError {}

// Always handle at the socket level
socket.on('error', (err: Error) => {
  logger.warn({ err, playerId: socket.session?.charId }, 'Socket error');
  socket.destroy();
});

// Async handlers wrapped in try/catch
async function handleLoginCertify(socket: FlyffSocket, reader: PacketReader): Promise<void> {
  try {
    await authService.verify(reader.readString(), reader.readString());
  } catch (err) {
    if (err instanceof AuthError) {
      sendLoginFail(socket, err.code);
    } else {
      logger.error({ err }, 'Unexpected login error');
    }
  }
}
```

---

## Logging

Use **pino** (structured JSON logging):

```ts
// packages/core/src/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: process.env['SERVER_NAME'] ?? 'flyff' },
});
```

Log levels:
| Level | When |
|---|---|
| `trace` | Per-packet, per-tick debug (dev only) |
| `debug` | Handler entry/exit, session changes |
| `info` | Server start, player connect/disconnect |
| `warn` | Unknown opcodes, validation failures |
| `error` | Unexpected exceptions |
| `fatal` | Unrecoverable server errors |

---

## ESLint Config (`eslint.config.ts`)

```ts
import tseslint from 'typescript-eslint';
import eslint from '@eslint/js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

---

## General Rules

- **No `any`** — use `unknown` + type guards, generics, or Zod parsing
- **No magic numbers** — extract to named `const` with `as const`
- **No `process.exit()` in library code** — only in server entry points
- **No synchronous file I/O at runtime** — `fs.readFileSync` only during startup resource loading
- **Max function length: ~50 lines** — extract helpers if longer
- **Max file length: ~300 lines** — split into submodules if longer
- Prefer `async/await` over raw `.then()` chains
- All `async` functions must handle rejection (try/catch or `.catch()`)
- Never `await` inside a tight `setInterval` tick — defer with a queue
- Use `node:` prefix on built-in imports (`node:net`, `node:crypto`, etc.)
- Use `.js` extension in imports even for `.ts` source (required for Node16 ESM)
