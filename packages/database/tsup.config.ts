import { defineConfig } from 'tsup';

// Multi-entry: index barrel + every repository + every migration as its own
// emitted file, so `@flyff/database/repositories/*` and `/migrations/*` resolve.
export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts', 'src/repositories/*.ts', 'src/migrations/*.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Externalize npm + workspace deps -- they resolve from node_modules at
  // runtime (pnpm workspace for @flyff/*). Bundling them pulls in CJS modules
  // (knex/better-sqlite3) whose dynamic require() of node builtins throws
  // under ESM ("Dynamic require of 'tty' is not supported").
  external: ['@flyff/core', 'better-sqlite3', 'knex', 'mysql2', 'pg', 'zod'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
