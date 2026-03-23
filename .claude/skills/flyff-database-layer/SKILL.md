---
name: flyff-database-layer
description: >
  Database layer architecture, schema design, repository pattern, Knex.js multi-database
  support (SQLite3/PostgreSQL/MySQL), migrations, connection pooling, query optimisation,
  and caching strategy for the Flyff TypeScript server emulator.
  Use this skill when writing database queries, designing tables, setting up migrations,
  working with Knex, pg, mysql2, or sqlite3, implementing the repository pattern,
  handling transactions, caching with Redis or Cloudflare KV, or optimising slow queries.
  Trigger on: "database", "SQL", "query", "table", "schema", "migration", "repository",
  "pg", "mysql", "sqlite", "pool", "transaction", "index", "cache", "Redis", "save character",
  "load inventory", "persist", "ORM", "knex", "Prisma".
---

# Flyff Emulator — Database Layer

## Technology Choices

| Layer | Choice | Why |
|---|---|---|
| Query builder | **Knex.js** | Works with SQLite3, PostgreSQL, MySQL — no ORM lock-in |
| SQLite3 driver | **better-sqlite3** | Fastest SQLite driver, synchronous API |
| PostgreSQL driver | **pg** (node-postgres) | Battle-tested, Knex first-class support |
| MySQL driver | **mysql2** | Modern, Knex first-class support |
| Migration | **Knex migrate** | Built-in to Knex, supports all adapters |
| Cache / IPC | **ICacheAdapter** (see flyff-cache-layer) | Swap Redis ↔ Cloudflare ↔ Memory |

Switch adapters via `DB_CLIENT` env var: `sqlite3` | `pg` | `mysql2`.

---

## Knex Connection Factory (`packages/database/src/db.ts`)

```ts
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { config } from '@flyff/core/config.js';
import { logger } from '@flyff/core/logger.js';

function createKnex(): KnexType {
  const client = config.DB_CLIENT;

  const connection = client === 'sqlite3'
    ? { filename: config.DB_FILENAME ?? './dev.sqlite3' }
    : config.DB_URL;

  const knex = Knex({
    client,
    connection,
    useNullAsDefault: client === 'sqlite3',
    pool: client === 'sqlite3'
      ? { min: 1, max: 1 }                     // SQLite: single connection
      : { min: 2, max: 20,
          idleTimeoutMillis: 30_000,
          acquireTimeoutMillis: 5_000 },
    acquireConnectionTimeout: 5_000,
  });

  // Slow query logging
  knex.on('query', (query: { sql: string; __knexQueryUid: string }) => {
    const uid = query.__knexQueryUid;
    (knex as unknown as Record<string, unknown>)[`__ts_${uid}`] = Date.now();
  });

  knex.on('query-response', (_response: unknown, query: { sql: string; __knexQueryUid: string }) => {
    const startKey = `__ts_${query.__knexQueryUid}`;
    const start = (knex as unknown as Record<string, number>)[startKey];
    if (start) {
      const ms = Date.now() - start;
      if (ms > 200) logger.warn({ ms, sql: query.sql }, 'Slow query');
    }
  });

  return knex;
}

export const db = createKnex();

/** Run multiple queries in one transaction (atomic). */
export async function withTransaction<T>(fn: (trx: KnexType.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function connect(): Promise<void> {
  await db.raw('select 1');
  logger.info({ client: config.DB_CLIENT }, 'DB connected');
}

export async function disconnect(): Promise<void> {
  await db.destroy();
}
```

---

## Full Schema (Knex Migrations)

Use Knex migration files in `packages/database/src/migrations/`.

### `001_initial.ts`
```ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('accounts', t => {
    t.increments('id').primary();
    t.string('username', 24).unique().notNullable();
    t.string('password_hash', 128).notNullable();
    t.smallint('status').notNullable().defaultTo(1); // 0=banned, 1=active, 2=GM
    t.string('last_ip', 45).nullable();
    t.timestamp('last_login', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['username']);
  });

  await knex.schema.createTable('characters', t => {
    t.increments('id').primary();
    t.integer('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('name', 24).unique().notNullable();
    t.smallint('slot').notNullable().defaultTo(0);
    t.smallint('job').notNullable().defaultTo(0);
    t.smallint('level').notNullable().defaultTo(1);
    t.bigInteger('exp').notNullable().defaultTo(0);
    t.integer('hp').notNullable().defaultTo(100);
    t.integer('mp').notNullable().defaultTo(50);
    t.integer('fp').notNullable().defaultTo(50);
    t.bigInteger('gold').notNullable().defaultTo(0);
    t.float('pos_x').notNullable().defaultTo(0);
    t.float('pos_y').notNullable().defaultTo(0);
    t.float('pos_z').notNullable().defaultTo(0);
    t.integer('zone_id').notNullable().defaultTo(1);
    t.smallint('str_stat').notNullable().defaultTo(15);
    t.smallint('sta_stat').notNullable().defaultTo(15);
    t.smallint('dex_stat').notNullable().defaultTo(15);
    t.smallint('int_stat').notNullable().defaultTo(15);
    t.smallint('stat_points').notNullable().defaultTo(0);
    t.smallint('skill_points').notNullable().defaultTo(0);
    t.integer('play_time').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'slot']);
    t.index(['account_id']);
  });

  await knex.schema.createTable('inventory', t => {
    t.increments('id').primary();
    t.integer('char_id').notNullable().references('id').inTable('characters').onDelete('CASCADE');
    t.smallint('slot').notNullable();
    t.integer('item_id').notNullable();
    t.integer('count').notNullable().defaultTo(1);
    t.smallint('upgrade').notNullable().defaultTo(0);
    t.timestamp('expire_at', { useTz: true }).nullable();
    t.unique(['char_id', 'slot']);
    t.index(['char_id']);
  });

  await knex.schema.createTable('char_skills', t => {
    t.integer('char_id').notNullable().references('id').inTable('characters').onDelete('CASCADE');
    t.integer('skill_id').notNullable();
    t.smallint('level').notNullable().defaultTo(0);
    t.primary(['char_id', 'skill_id']);
  });

  await knex.schema.createTable('char_buffs', t => {
    t.integer('char_id').notNullable().references('id').inTable('characters').onDelete('CASCADE');
    t.integer('skill_id').notNullable();
    t.smallint('level').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.primary(['char_id', 'skill_id']);
  });

  await knex.schema.createTable('guilds', t => {
    t.increments('id').primary();
    t.string('name', 24).unique().notNullable();
    t.integer('leader_id').notNullable().references('id').inTable('characters');
    t.smallint('level').notNullable().defaultTo(1);
    t.bigInteger('exp').notNullable().defaultTo(0);
    t.string('notice', 256).defaultTo('');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('guild_members', t => {
    t.integer('guild_id').notNullable().references('id').inTable('guilds').onDelete('CASCADE');
    t.integer('char_id').notNullable().references('id').inTable('characters').onDelete('CASCADE');
    t.smallint('rank').notNullable().defaultTo(0);
    t.timestamp('joined_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['guild_id', 'char_id']);
  });

  await knex.schema.createTable('bans', t => {
    t.increments('id').primary();
    t.integer('account_id').nullable().references('id').inTable('accounts');
    t.integer('char_id').nullable().references('id').inTable('characters');
    t.string('ip', 45).nullable();
    t.string('reason', 256).nullable();
    t.timestamp('expires_at', { useTz: true }).nullable(); // NULL = permanent
    t.timestamp('banned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('banned_by').nullable().references('id').inTable('accounts');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bans');
  await knex.schema.dropTableIfExists('guild_members');
  await knex.schema.dropTableIfExists('guilds');
  await knex.schema.dropTableIfExists('char_buffs');
  await knex.schema.dropTableIfExists('char_skills');
  await knex.schema.dropTableIfExists('inventory');
  await knex.schema.dropTableIfExists('characters');
  await knex.schema.dropTableIfExists('accounts');
}
```

---

## Repository Pattern

One class per aggregate. No raw SQL strings, no Knex outside repository files.

### `repositories/account.repo.ts`
```ts
import type { Knex as KnexType } from 'knex';
import type { IAccountRow } from '@flyff/core/types/entities.js';
import { db } from '../db.js';

export class AccountRepository {
  constructor(private readonly knex: KnexType = db) {}

  async findByUsername(username: string): Promise<IAccountRow | null> {
    const row = await this.knex<IAccountRow>('accounts')
      .select('id', 'password_hash', 'status', 'last_ip', 'last_login')
      .where({ username })
      .first();
    return row ?? null;
  }

  async create(username: string, passwordHash: string): Promise<number> {
    const [id] = await this.knex('accounts')
      .insert({ username, password_hash: passwordHash })
      .returning('id');
    return id as number;
  }

  async updateLastLogin(id: number, ip: string): Promise<void> {
    await this.knex('accounts')
      .where({ id })
      .update({ last_login: new Date(), last_ip: ip });
  }

  async setStatus(id: number, status: number): Promise<void> {
    await this.knex('accounts').where({ id }).update({ status });
  }
}

export const accountRepo = new AccountRepository();
```

### `repositories/character.repo.ts`
```ts
import type { Knex as KnexType } from 'knex';
import type { ICharacterRow, IInventoryItem } from '@flyff/core/types/entities.js';
import type { CPlayer } from '@flyff/world-server/entities/player.js';
import { db, withTransaction } from '../db.js';

export class CharacterRepository {
  constructor(private readonly knex: KnexType = db) {}

  async findById(id: number): Promise<ICharacterRow | null> {
    const row = await this.knex<ICharacterRow>('characters').where({ id }).first();
    return row ?? null;
  }

  async findByAccountId(accountId: number): Promise<ICharacterRow[]> {
    return this.knex<ICharacterRow>('characters')
      .where({ account_id: accountId })
      .orderBy('slot');
  }

  async create(accountId: number, name: string, job: number, slot: number): Promise<ICharacterRow> {
    const [row] = await this.knex('characters')
      .insert({ account_id: accountId, name, job, slot })
      .returning('*');
    return row as ICharacterRow;
  }

  /** Full character save — called on logout and periodic flush. */
  async save(player: CPlayer): Promise<void> {
    await withTransaction(async trx => {
      await trx('characters').where({ id: player.m_dwCharId }).update({
        level:        player.m_nLevel,
        exp:          player.m_nExp,
        hp:           player.m_nHP,
        mp:           player.m_nMP,
        gold:         player.m_nGold,
        pos_x:        player.m_vPos.x,
        pos_y:        player.m_vPos.y,
        pos_z:        player.m_vPos.z,
        zone_id:      player.m_nZoneId,
        str_stat:     player.m_nStr,
        sta_stat:     player.m_nSta,
        dex_stat:     player.m_nDex,
        int_stat:     player.m_nInt,
        stat_points:  player.m_nStatPoints,
        skill_points: player.m_nSkillPoints,
        play_time:    trx.raw('play_time + ?', [player.sessionPlayTime]),
      });

      // Bulk replace inventory
      await trx('inventory').where({ char_id: player.m_dwCharId }).delete();
      const items = player.m_aInventory.filter((item): item is IInventoryItem =>
        item != null && item.dwItemId !== 0
      );
      if (items.length > 0) {
        await trx('inventory').insert(
          items.map(item => ({
            char_id:  player.m_dwCharId,
            slot:     item.nSlot,
            item_id:  item.dwItemId,
            count:    item.wCount,
            upgrade:  item.nUpgrade,
          }))
        );
      }
    });
  }

  async delete(id: number): Promise<void> {
    await this.knex('characters').where({ id }).delete();
  }
}

export const characterRepo = new CharacterRepository();
```

---

## Migration Runner (`packages/database/src/migrate.ts`)

```ts
import { db } from './db.js';
import { logger } from '@flyff/core/logger.js';

async function migrate(): Promise<void> {
  logger.info('Running migrations...');
  const [batchNo, migrations] = await db.migrate.latest({
    directory: new URL('./migrations', import.meta.url).pathname,
    extension: 'ts',  // or 'js' after build
    loadExtensions: ['.ts'],
  });
  if (migrations.length === 0) {
    logger.info('No new migrations.');
  } else {
    logger.info({ batchNo, migrations }, `Applied ${migrations.length} migration(s)`);
  }
  await db.destroy();
}

migrate().catch(err => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
```

Run with: `pnpm --filter @flyff/database migrate`

---

## Dirty Tracking (Avoid Unnecessary Writes)

```ts
// entities/player.ts
class CPlayer extends CMover {
  readonly _dirty = new Set<string>();

  setGold(amount: number): void {
    this.m_nGold = amount;
    this._dirty.add('gold');
  }

  setLevel(lv: number): void {
    this.m_nLevel = lv;
    this._dirty.add('level');
  }

  get isDirty(): boolean { return this._dirty.size > 0; }
  clearDirty(): void { this._dirty.clear(); }
}
```

Periodic flush (every 30s) — save dirty players and clear their WAL journal:
```ts
// See flyff-state-persistence for the full journal clearing implementation
setInterval(() => {
  void (async () => {
    const dirty = playerManager.all().filter(p => p.isDirty);
    if (dirty.length === 0) return;

    await Promise.allSettled(dirty.map(async p => {
      const syncTime = Date.now();
      await characterRepo.save(p);

      // If save succeeds, clear dirty flag and WAL journal
      p.clearDirty();
      clearJournal(p.m_dwCharId, syncTime);
    }));
  })();
}, 30_000);
```

---

## SQLite-Specific Notes

- SQLite enforces foreign keys only if enabled: `PRAGMA foreign_keys = ON;`
- Knex sets this automatically when `client = 'sqlite3'` — verify with a migration
- Use `useNullAsDefault: true` in Knex config for SQLite
- Connection pool max = 1 for SQLite (no concurrent writes)
- `bigInteger` columns: SQLite returns them as strings — parse with `BigInt(row.exp)`
- `better-sqlite3` does NOT support `returning('*')` — use `knex.raw` workaround or separate select

```ts
// SQLite-safe insert returning
async function insertReturning<T>(table: string, data: object): Promise<T> {
  if (config.DB_CLIENT === 'sqlite3') {
    const [id] = await db(table).insert(data);
    const row = await db<T>(table).where({ id }).first();
    if (!row) throw new Error(`Insert failed for ${table}`);
    return row;
  }
  const [row] = await db(table).insert(data).returning('*');
  return row as T;
}
```

---

## Query Optimisation Tips

- Always index foreign keys and frequently filtered columns (Knex handles this in migrations)
- Use Knex `.select('col1', 'col2')` — never `SELECT *` in production repos
- Batch inventory inserts — `DELETE` all then bulk `INSERT` is faster than per-row upsert for small sets
- Keep transactions short — release the client as fast as possible
- For read-heavy endpoints (character list), use the cache layer with `ICacheAdapter`
- Add `t.index([...])` in migration for any column used in `WHERE`, `ORDER BY`, or `JOIN`