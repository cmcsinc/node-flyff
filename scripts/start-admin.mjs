#!/usr/bin/env node
// Dev launcher for the Next.js admin panel (@flyff/admin).
// Ensures workspace deps are installed, applies the admin Drizzle schema, then
// boots `next dev`. Run:  node scripts/start-admin.mjs    (or `pnpm admin:run`)
//
// Admin reads config + the dev SQLite DB relative to the repo root, so this
// script sets cwd to the repo root explicitly — do not run it from elsewhere.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ADMIN = join(ROOT, 'packages', 'admin');
const IS_WIN = process.platform === 'win32';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const log = (msg) => console.log(`${CYAN}[admin]${RESET} ${msg}`);

/** Run a command to completion, inheriting stdio. Rejects on non-zero exit. */
function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: IS_WIN,
      ...opts,
    });
    child.on('error', rej);
    child.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`)),
    );
  });
}

async function main() {
  if (!existsSync(ADMIN)) {
    throw new Error(`admin package not found at ${ADMIN}`);
  }

  // 1. Install workspace deps if node_modules is missing.
  if (!existsSync(join(ROOT, 'node_modules'))) {
    log('installing workspace dependencies (pnpm install)...');
    await run('pnpm', ['install']);
  }

  // 2. Apply the admin Drizzle schema to the local SQLite DB (idempotent).
  log('applying admin database schema (drizzle-kit push)...');
  try {
    await run('pnpm', ['--filter', '@flyff/admin', 'db:push']);
  } catch (err) {
    log(`db:push skipped/failed (${err.message}) — continuing to dev server`);
  }

  // 3. Boot the Next.js dev server (long-running, inherits Ctrl-C).
  const port = process.env.ADMIN_PORT || '3000';
  log(`starting Next.js dev server on http://localhost:${port} ...`);
  const dev = spawn('pnpm', ['--filter', '@flyff/admin', 'dev', '--', '--port', port], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
  });

  const shutdown = () => {
    if (!dev.killed) dev.kill('SIGINT');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  dev.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(`${CYAN}[admin]${RESET} ${err.message}`);
  process.exit(1);
});
