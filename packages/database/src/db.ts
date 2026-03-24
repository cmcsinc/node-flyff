import * as knexModule from 'knex';
import { z } from 'zod';

const knex = (knexModule as any).default || knexModule;

/**
 * Zod schema for database configuration.
 * Supports SQLite3, PostgreSQL, and MySQL/MariaDB.
 */
const DbConfigSchema = z.object({
  client: z.enum(['sqlite3', 'pg', 'mysql2']),
  connection: z.union([
    z.string(), // filename for SQLite
    z.object({
      host: z.string(),
      port: z.number(),
      user: z.string(),
      password: z.string(),
      database: z.string(),
    }),
  ]),
});

export type DbConfig = z.infer<typeof DbConfigSchema>;

/**
 * Creates a Knex database connection.
 *
 * Pool configuration:
 * - SQLite3: min=1, max=1 (single connection due to file locking)
 * - PostgreSQL/MySQL: min=2, max=10 (connection pooling)
 *
 * @param config - Validated database configuration
 * @returns Configured Knex instance
 */
export function createDb(config: DbConfig): ReturnType<typeof knex> {
  const validated = DbConfigSchema.parse(config);

  return knex({
    client: validated.client,
    connection: validated.connection,
    pool: validated.client === 'sqlite3'
      ? { min: 1, max: 1 }
      : { min: 2, max: 10 },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations',
    },
  });
}
