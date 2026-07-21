#!/usr/bin/env node
// Dev launcher: boots login (:23000 certifier), cluster (:5400 cache), world (:2000)
// repo root with sane defaults. Prefixes each server's logs and cleans up on
// Ctrl-C. Run:  node scripts/start-servers.mjs    (or `pnpm servers`)
//
// Servers MUST run from the repo root (config + DB path are cwd-relative), so
// this script sets cwd explicitly — do not run it from elsewhere.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const RESET = '\x1b[0m';

const SERVERS = [
  { tag: 'login', color: '\x1b[36m', port: 23000, entry: 'packages/login-server/src/index.ts' },
  { tag: 'cluster', color: '\x1b[35m', port: 5400, entry: 'packages/cluster-server/src/index.ts' },
  { tag: 'world', color: '\x1b[33m', port: 2000, entry: 'packages/world-server/src/index.ts' },
];

function loadDotEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Build a line pump that prefixes each emitted line with a colored `[tag]`.
 * Indented continuation lines (pino-pretty object fields) are aligned under
 * the timestamp with spaces instead of a second tag, so multi-line records
 * stay readable. Children run with LOG_PRETTY=1 + FORCE_COLOR=1 so the piped
 * stdout still emits colored pretty output (pino's TTY auto-detect would
 * otherwise fall back to raw JSON).
 */
function makePump(tag, color) {
  const prefix = `${color}[${tag}]${RESET} `;
  const pad = ' '.repeat(tag.length + 3); // visible width of "[tag] "
  return (chunk) => {
    for (const l of chunk.toString().split(/\r?\n/)) {
      if (!l.length) continue;
      process.stdout.write((/^\s/.test(l) ? pad : prefix) + l + '\n');
    }
  };
}

/** Run a child to completion, streaming its output prefixed. */
function run(cmd, args, env, tag, color) {
  return new Promise((resolveExit) => {
    const child = spawn(cmd, args, {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN,
    });
    const pump = makePump(tag, color);
    child.stdout.on('data', pump);
    child.stderr.on('data', pump);
    child.on('exit', resolveExit);
  });
}

async function main() {
  // --- env + data dir --------------------------------------------------------
  const envPath = resolve(ROOT, '.env');
  const env = { ...process.env, ...loadDotEnv(envPath) };
  if (!env['IPC_SECRET'] || env['IPC_SECRET'].length < 16) {
    const secret = randomBytes(24).toString('hex');
    appendFileSync(envPath, `IPC_SECRET=${secret}\n`);
    env['IPC_SECRET'] = secret;
    console.log(`[launcher] generated IPC_SECRET (>=16 chars) → ${envPath}`);
  }
  env['DB_FILENAME'] = env['DB_FILENAME'] ?? './data/flyff_dev.sqlite3';
  if (env['DB_FILENAME'] !== ':memory:') {
    mkdirSync(resolve(ROOT, dirname(env['DB_FILENAME'])), { recursive: true });
  }

  // --- redis hint ------------------------------------------------------------
  const hasLocalOverride =
    existsSync(resolve(ROOT, 'config/default.local.yml')) ||
    existsSync(resolve(ROOT, 'config/default.local.json'));
  if (!hasLocalOverride) {
    console.log(
      '[launcher] NOTE: no config/default.local.yml → cache defaults to "memory".\n' +
      '         Cross-server handoff (cluster→world) needs Redis. See\n' +
      '         docs/runbooks/real-client-smoke.md §2 for the override snippet.',
    );
  }

  // --- seed once (auto-migrates + creates test/test) -------------------------
  console.log('[launcher] seeding DB (idempotent; creates account test/test)...');
  await run('npx', ['tsx', 'packages/login-server/src/seed.ts'], env, 'seed', '\x1b[90m');

  // --- banner + boot ---------------------------------------------------------
  console.log('\n=== Flyff dev servers (default ports) ===');
  for (const s of SERVERS) console.log(`  ${s.tag.padEnd(8)} → 127.0.0.1:${s.port}`);
  console.log('  (Ctrl-C stops all)\n');

  const procs = [];
  // Children inherit a LOG_PRETTY=1 + FORCE_COLOR=1 hint: their stdout is a
  // pipe (not a TTY), so without this they'd emit raw JSON and no color.
  const childEnv = { ...env, LOG_PRETTY: '1', FORCE_COLOR: '1' };
  for (const s of SERVERS) {
    const child = spawn('npx', ['tsx', s.entry], {
      cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN,
    });
    const pump = makePump(s.tag, s.color);
    child.stdout.on('data', pump);
    child.stderr.on('data', pump);
    child.on('exit', (code) => console.log(`${s.color}[${s.tag}]${RESET} exited with code ${code}`));
    procs.push(child);
  }

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[launcher] ${signal} — stopping all servers…`);
    for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

await main();
