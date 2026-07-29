/**
 * Shared contract between the supervisor daemon and its admin-side client.
 *
 * The daemon is a standalone process that owns the game-server children, so
 * stopping/restarting the Next.js admin app does not take the servers down.
 * Everything in here is imported by BOTH sides — keep it free of side effects
 * beyond path resolution.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATA_DIR = resolve(ROOT, 'data');
export const CONFIG_DIR = resolve(ROOT, 'config');
export const LOG_DIR = resolve(DATA_DIR, 'logs');
/** `{ pid, port, startedAt }` — how the client discovers a live daemon. */
export const HANDLE_FILE = resolve(DATA_DIR, 'supervisor.json');
/** Random shared secret; every daemon request must present it. */
export const TOKEN_FILE = resolve(DATA_DIR, 'supervisor.token');
export const DAEMON_ENTRY = resolve(ROOT, 'packages', 'admin', 'lib', 'supervisor-daemon.ts');
export const DEFAULT_PORT = Number(process.env.SUPERVISOR_PORT ?? 28900);
export const AUTH_HEADER = 'x-supervisor-token';
export const LOG_RING = 500;

export type ServerType = 'login' | 'cluster' | 'world';
export type RunState = 'stopped' | 'starting' | 'running' | 'exited';

/** Entry module per server type, relative to the repo root. */
export const ENTRY: Record<ServerType, string> = {
  login: 'packages/login-server/src/index.ts',
  cluster: 'packages/cluster-server/src/index.ts',
  world: 'packages/world-server/src/index.ts',
};

export interface ProcStatus {
  state: RunState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
}

export interface LogLine {
  seq: number;
  ts: number;
  line: string;
}

export interface DaemonHandle {
  pid: number;
  port: number;
  startedAt: number;
}

/** POST /start body. `configFile` is produced by the admin side. */
export interface SpawnRequest {
  id: string;
  type: ServerType;
  configFile: string;
  /** Extra env for the child (CONFIG_FILE etc. are set by the daemon). */
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested — see test/supervisor.test.ts)
// ---------------------------------------------------------------------------

/** `id` must be filesystem- and `server.id`-safe. */
export function isValidInstanceId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{1,31}$/i.test(id);
}

/** Drops ANSI colour codes so log lines render cleanly in the browser. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Validates an untrusted /start body. */
export function parseSpawnRequest(raw: unknown): { req: SpawnRequest } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'Invalid body' };
  const { id, type, configFile, env } = raw as Record<string, unknown>;
  if (!isValidInstanceId(id)) return { error: 'Invalid id' };
  if (typeof type !== 'string' || !(type in ENTRY)) return { error: 'Invalid type' };
  if (typeof configFile !== 'string' || configFile.length === 0) return { error: 'Invalid configFile' };
  const envOut: Record<string, string> = {};
  if (env !== undefined) {
    if (typeof env !== 'object' || env === null || Array.isArray(env)) return { error: 'Invalid env' };
    for (const [k, v] of Object.entries(env)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(k) || typeof v !== 'string') return { error: `Invalid env key: ${k}` };
      envOut[k] = v;
    }
  }
  return { req: { id, type: type as ServerType, configFile, env: envOut } };
}

/** Appends `line` to a bounded ring, mutating and returning it. */
export function pushRing(ring: LogLine[], entry: LogLine, max = LOG_RING): LogLine[] {
  ring.push(entry);
  if (ring.length > max) ring.splice(0, ring.length - max);
  return ring;
}

/** Length-safe constant-time token comparison. */
export function tokensMatch(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length || b.length === 0) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ---------------------------------------------------------------------------
// Token + handle files
// ---------------------------------------------------------------------------

/** Reads the shared secret, creating it on first use. Daemon side. */
export function readOrCreateToken(): string {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(TOKEN_FILE)) {
    const existing = readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (existing.length >= 32) return existing;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_FILE, `${token}\n`, { encoding: 'utf-8', mode: 0o600 });
  return token;
}

/** Client side — null when no daemon has ever run. */
export function readToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  const t = readFileSync(TOKEN_FILE, 'utf-8').trim();
  return t.length >= 32 ? t : null;
}

export function readHandle(): DaemonHandle | null {
  if (!existsSync(HANDLE_FILE)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(HANDLE_FILE, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { pid, port, startedAt } = parsed as Record<string, unknown>;
    if (typeof pid !== 'number' || typeof port !== 'number') return null;
    return { pid, port, startedAt: typeof startedAt === 'number' ? startedAt : 0 };
  } catch {
    return null;
  }
}

export function writeHandle(handle: DaemonHandle): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(HANDLE_FILE, `${JSON.stringify(handle, null, 2)}\n`, 'utf-8');
}

/** Minimal `.env` reader — same contract as scripts/start-servers.mjs. */
export function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}
