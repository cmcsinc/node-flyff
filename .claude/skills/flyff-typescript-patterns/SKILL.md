---
name: flyff-typescript-patterns
description: >
  TypeScript-specific patterns, strict config, Zod validation, generics, type guards, and
  decorator patterns for the Flyff Node.js server emulator in TypeScript. Use this skill
  whenever setting up TypeScript config, using Zod for validation, writing generic utilities,
  creating type guards, defining interfaces for game objects, using decorators, or solving
  TypeScript-specific problems. Trigger on: "typescript", "tsconfig", "strict", "zod",
  "schema", "type guard", "generic", "interface", "decorator", "infer", "satisfies",
  "as const", "unknown", "never", "discriminated union", "type narrowing", "Partial",
  "Required", "Pick", "Omit", "ReturnType", "Parameters".
---

# Flyff Emulator — TypeScript Patterns

## Project TypeScript Setup

### Root `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
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
  }
}
```

### Per-package `tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }]
}
```

### `package.json` for each package
```json
{
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc --build",
    "test": "node --test --import tsx/esm src/**/*.test.ts",
    "lint": "eslint src"
  }
}
```

---

## Zod for Input Validation

Always use Zod to parse untrusted input (env config, IPC messages, packet fields).

### Config file vs schema default (gotcha)

`loadConfig` (`packages/core/src/config/loader.ts`) layers `config/default.json` → `config/<server>.json` → `config/*.yml` → env, **last-wins, on top of** Zod `.default()`. A `.default()` only fires when no layer provides the key. When changing a real-world default (spawn coords, ports, limits), update BOTH the schema `.default()` AND the matching key in `config/<server>.json`, then restart — config is read once at boot.

### Environment Config
```ts
// packages/core/src/config.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV:        z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL:       z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DB_CLIENT:       z.enum(['sqlite3', 'pg', 'mysql2']).default('sqlite3'),
  DB_FILENAME:     z.string().optional(),  // sqlite only
  DB_URL:          z.string().optional(),  // pg / mysql
  REDIS_URL:       z.string().default('redis://localhost:6379'),
  IPC_SECRET:      z.string().min(32),     // HMAC signing key
  SERVER_ID:       z.string().min(1),
  SERVER_NAME:     z.string().min(1),
  WORLD_SERVER_IP: z.string().optional(),
  WORLD_PORT:      z.coerce.number().int().default(38180),
  CLUSTER_PORT:    z.coerce.number().int().default(38100),
  LOGIN_PORT:      z.coerce.number().int().default(23000),
  MAX_PLAYERS:     z.coerce.number().int().default(500),
});

export type Config = z.infer<typeof ConfigSchema>;

// Parse at startup — throws if env is invalid
export const config = ConfigSchema.parse(process.env);
```

### IPC Message Schema
```ts
// packages/ipc/src/schemas/playerEnter.schema.ts
import { z } from 'zod';

export const PlayerEnterSchema = z.object({
  token:     z.string().uuid(),
  accountId: z.number().int().positive(),
  charId:    z.number().int().positive(),
  zoneId:    z.number().int().positive(),
});

export type PlayerEnterPayload = z.infer<typeof PlayerEnterSchema>;
```

### Packet Field Validation
```ts
// packages/core/src/validate.ts
import { z } from 'zod';
import { PacketError } from './errors/index.js';

export const PacketValidate = {
  byte(val: unknown, field = 'field'): asserts val is number {
    const result = z.number().int().min(0).max(255).safeParse(val);
    if (!result.success) throw new PacketError(`Invalid ${field}: ${val}`, 'INVALID_FIELD');
  },
  word(val: unknown, field = 'field'): asserts val is number {
    const result = z.number().int().min(0).max(65535).safeParse(val);
    if (!result.success) throw new PacketError(`Invalid ${field}: ${val}`, 'INVALID_FIELD');
  },
  slot(val: unknown): asserts val is number {
    const result = z.number().int().min(0).max(119).safeParse(val);
    if (!result.success) throw new PacketError(`Invalid slot: ${val}`, 'INVALID_SLOT');
  },
  charName(val: unknown): asserts val is string {
    const result = z.string().min(3).max(24).regex(/^[a-zA-Z0-9]+$/).safeParse(val);
    if (!result.success) throw new PacketError(`Invalid name: ${val}`, 'INVALID_NAME');
  },
};
```

---

## Type Guards

```ts
// packages/core/src/utils/typeGuards.ts

export function isString(val: unknown): val is string {
  return typeof val === 'string';
}

export function isNumber(val: unknown): val is number {
  return typeof val === 'number' && !isNaN(val);
}

export function isNonNull<T>(val: T | null | undefined): val is T {
  return val != null;
}

// Exhaustive check for discriminated unions
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
```

---

## Typed Entity Interfaces

```ts
// packages/core/src/types/entities.ts

export interface IPosition {
  x: number;
  y: number;
  z: number;
}

export interface IInventoryItem {
  dwItemId: number;
  nSlot: number;
  wCount: number;
  nUpgrade: number;
}

export interface ICharacterRow {
  id: number;
  account_id: number;
  name: string;
  slot: number;
  job: number;
  level: number;
  exp: bigint;
  hp: number;
  mp: number;
  fp: number;
  gold: bigint;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  zone_id: number;
  str_stat: number;
  sta_stat: number;
  dex_stat: number;
  int_stat: number;
  stat_points: number;
  skill_points: number;
  play_time: number;
}

export interface IAccountRow {
  id: number;
  username: string;
  password_hash: string;
  status: number;
  last_ip: string | null;
  last_login: Date | null;
  created_at: Date;
}
```

---

## Generic Repository Base

```ts
// packages/database/src/repositories/base.repo.ts
import type { Knex } from 'knex';

export abstract class BaseRepository<TRow extends { id: number }> {
  constructor(
    protected readonly db: Knex,
    protected readonly table: string,
  ) {}

  async findById(id: number): Promise<TRow | null> {
    const row = await this.db<TRow>(this.table).where({ id }).first();
    return row ?? null;
  }

  async findAll(): Promise<TRow[]> {
    return this.db<TRow>(this.table).select('*');
  }

  async deleteById(id: number): Promise<void> {
    await this.db(this.table).where({ id }).delete();
  }
}
```

---

## Typed EventBus

```ts
// packages/core/src/eventBus.ts
import { EventEmitter } from 'node:events';
import type { CPlayer } from '../entities/player.js';

// Define all events and their payload types
interface FlyffEvents {
  'player:exp_change':  { player: CPlayer; amount: number };
  'player:level_up':   { player: CPlayer; newLevel: number };
  'player:die':        { player: CPlayer; killer: CPlayer | null };
  'player:disconnect': { player: CPlayer };
  'zone:monster_die':  { monsterId: number; zoneId: number; killerId: number };
}

class TypedEventBus extends EventEmitter {
  emit<K extends keyof FlyffEvents>(event: K, payload: FlyffEvents[K]): boolean {
    return super.emit(event as string, payload);
  }

  on<K extends keyof FlyffEvents>(event: K, listener: (payload: FlyffEvents[K]) => void): this {
    return super.on(event as string, listener);
  }

  once<K extends keyof FlyffEvents>(event: K, listener: (payload: FlyffEvents[K]) => void): this {
    return super.once(event as string, listener);
  }
}

export const bus = new TypedEventBus();
export type { FlyffEvents };
```

---

## Discriminated Unions for Packet Results

```ts
// Use discriminated unions for safe result handling
type PacketResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code: string };

function parseLoginPacket(buf: Buffer): PacketResult<{ username: string; password: string }> {
  try {
    const reader = new PacketReader(buf);
    return { ok: true, data: {
      username: reader.readString(),
      password: reader.readString(),
    }};
  } catch (err) {
    return { ok: false, error: String(err), code: 'PARSE_FAIL' };
  }
}
```

---

## `satisfies` Operator (TS 4.9+)

```ts
// Use satisfies to validate shape without widening
const OPCODES = {
  LOGIN_CERTIFY: 0xFC03,
  CHAR_LIST:     0xFB00,
  CHAR_SELECT:   0xFB0B,
} satisfies Record<string, number>;

// OPCODES.LOGIN_CERTIFY is typed as 0xFC03, not number
```

---

## Utility Types in Practice

```ts
// Pick only what a handler needs to send in a response
type CharacterSummary = Pick<ICharacterRow, 'id' | 'name' | 'level' | 'job'>;

// Omit password from what gets returned to clients
type SafeAccount = Omit<IAccountRow, 'password_hash'>;

// Service init pattern — partial dependencies
type ServiceDeps = {
  characterRepo: CharacterRepository;
  playerManager: PlayerManager;
};

class InventoryService {
  #deps!: ServiceDeps;

  init(deps: ServiceDeps): void {
    this.#deps = deps;
  }
}
```
