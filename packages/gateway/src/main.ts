import { Gateway } from './Gateway';
import { World } from './world/World';
import { createAuthHandlers } from './handlers/authHandlers';
import { createWorldHandlers } from './handlers/worldHandlers';
import { createLogger } from '@flyff/core';
import type { PacketHandlerMap } from './types';
import { AccountRepository, CharacterRepository, createDb } from '@flyff/database';
import type { Knex } from 'knex';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const logger = createLogger({ module: 'main' });

async function ensureSchema(db: Knex): Promise<void> {
  if (!(await db.schema.hasTable('accounts'))) {
    await db.schema.createTable('accounts', (t) => {
      t.increments('id').primary();
      t.string('username', 32).notNullable().unique();
      t.string('password_hash', 255).notNullable();
      t.string('email', 255).nullable();
      t.integer('authority').notNullable().defaultTo(0x46); // AUTH_GENERAL
      t.boolean('banned').defaultTo(false);
      t.timestamp('banned_until').nullable();
      t.timestamps(true, true);
    });
    logger.info('Created accounts table');
  }

  if (!(await db.schema.hasTable('characters'))) {
    await db.schema.createTable('characters', (t) => {
      t.increments('id').primary();
      t.integer('account_id').unsigned().notNullable()
        .references('id').inTable('accounts').onDelete('CASCADE');
      t.string('name', 16).notNullable().unique();
      t.integer('slot').unsigned().notNullable();
      t.integer('class').unsigned().defaultTo(0);
      t.integer('gender').unsigned().defaultTo(0);
      t.integer('hair_style').unsigned().defaultTo(1);
      t.integer('hair_color').unsigned().defaultTo(1);
      t.integer('face_style').unsigned().defaultTo(1);
      t.integer('skin_color').unsigned().defaultTo(1);
      t.integer('level').unsigned().defaultTo(1);
      t.bigInteger('exp').unsigned().defaultTo(0);
      t.integer('hp').unsigned().defaultTo(100);
      t.integer('mp').unsigned().defaultTo(50);
      t.integer('max_hp').unsigned().defaultTo(100);
      t.integer('max_mp').unsigned().defaultTo(50);
      t.integer('strength').unsigned().defaultTo(15);
      t.integer('stamina').unsigned().defaultTo(15);
      t.integer('dexterity').unsigned().defaultTo(15);
      t.integer('intelligence').unsigned().defaultTo(15);
      t.float('x').defaultTo(6967);
      t.float('y').defaultTo(100);
      t.float('z').defaultTo(3333);
      t.string('world_id', 32).defaultTo('flaris');
      t.integer('zone_id').unsigned().defaultTo(1);
      t.timestamps(true, true);
      t.unique(['account_id', 'slot']);
    });
    logger.info('Created characters table');
  }
}

async function main(): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? '28000', 10);
  const dbPath = process.env['DB_FILENAME'] ?? './data/flyff_dev.sqlite3';

  const dataDir = dirname(dbPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = createDb({ client: 'better-sqlite3', connection: dbPath });

  await ensureSchema(db);

  const accountRepo = new AccountRepository(db);
  const characterRepo = new CharacterRepository(db);

  const world = new World();
  world.start();

  const ctx: { gateway: Gateway | null } = { gateway: null };
  const getGateway = (): Gateway => {
    const { gateway } = ctx;
    if (gateway === null) throw new Error('Gateway accessed before initialization');
    return gateway;
  };

  const handlers: PacketHandlerMap = {
    ...createAuthHandlers(getGateway, accountRepo, characterRepo),
    ...createWorldHandlers(getGateway, world, characterRepo),
  };

  const gateway = new Gateway({ port, handlers });
  ctx.gateway = gateway;

  await gateway.start();

  // Accounts come from the login-server seed (`pnpm --filter @flyff/login-server
  // exec tsx src/seed.ts`) -- the gateway shares that DB and never mints its own.
  logger.info({ port }, 'Gateway ready -- connect via WebSocket');

  const shutdown = async (): Promise<void> => {
    world.stop();
    await gateway.stop();
    await db.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
