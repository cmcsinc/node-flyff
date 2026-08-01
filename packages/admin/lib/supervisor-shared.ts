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
/**
 * `[{ id, pid, startedAt }]` — the children a daemon owns, refreshed on every
 * spawn/exit. A replacement daemon reads this to ADOPT game servers left behind
 * by a previous daemon that died, so they stay stoppable instead of becoming
 * invisible orphans holding a client port (and ~240 MB) forever.
 */
export const CHILDREN_FILE = resolve(DATA_DIR, 'supervisor-children.json');
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

/**
 * Per-instance log buffer with long-poll waiters.
 *
 * Lives here rather than in the daemon so it is testable without booting the
 * daemon's HTTP server. Two behaviours matter to callers:
 *
 * - `clear()` drops the buffer server-side. A browser-side clear alone is not a
 *   clear — the next reader replays the ring from seq 0 and the lines come back.
 * - `wait()` resolves on the next `push` for that id, so a reader that is
 *   already current is released the instant output appears instead of on a
 *   fixed poll tick.
 */
export class LogHub {
  private readonly rings = new Map<string, LogLine[]>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private seq = 0;

  constructor(private readonly max = LOG_RING) {}

  /** Splits `raw` into lines, appends each, and wakes waiters. Returns the lines. */
  push(id: string, raw: string, onLine?: (line: string) => void): LogLine[] {
    const ring = this.rings.get(id) ?? [];
    const added: LogLine[] = [];
    for (const line of stripAnsi(raw).split(/\r?\n/)) {
      if (!line.length) continue;
      const entry: LogLine = { seq: ++this.seq, ts: Date.now(), line };
      pushRing(ring, entry, this.max);
      added.push(entry);
      onLine?.(line);
    }
    this.rings.set(id, ring);
    if (added.length) this.wake(id);
    return added;
  }

  /** Buffered lines for `id` newer than `since`. */
  since(id: string, since: number): LogLine[] {
    return (this.rings.get(id) ?? []).filter((l) => l.seq > since);
  }

  /** Empties `id`'s buffer and releases its waiters so they re-read. */
  clear(id: string): void {
    this.rings.set(id, []);
    this.wake(id);
  }

  /**
   * Resolves on the next push/clear for `id`, or after `timeoutMs`.
   * `onAbort` registers a caller-side cancel (e.g. the HTTP client hanging up).
   */
  wait(id: string, timeoutMs: number, onAbort?: (cancel: () => void) => void): Promise<void> {
    return new Promise<void>((done) => {
      const set = this.waiters.get(id) ?? new Set<() => void>();
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        set.delete(finish);
        done();
      };
      const timer = setTimeout(finish, timeoutMs);
      set.add(finish);
      this.waiters.set(id, set);
      onAbort?.(finish);
    });
  }

  private wake(id: string): void {
    const set = this.waiters.get(id);
    if (!set) return;
    this.waiters.delete(id);
    for (const fn of [...set]) fn();
  }
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

/** One owned child, as persisted for cross-daemon adoption. */
export interface ChildRecord {
  id: string;
  pid: number;
  startedAt: number;
}

/** Children recorded by whichever daemon ran last. `[]` when none/unreadable. */
export function readChildren(): ChildRecord[] {
  if (!existsSync(CHILDREN_FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(CHILDREN_FILE, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ChildRecord =>
        typeof r === 'object' &&
        r !== null &&
        isValidInstanceId((r as ChildRecord).id) &&
        Number.isInteger((r as ChildRecord).pid),
    );
  } catch {
    return [];
  }
}

export function writeChildren(records: ChildRecord[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CHILDREN_FILE, `${JSON.stringify(records, null, 2)}\n`, 'utf-8');
}

/** True when `pid` is a live process. Signal 0 probes without delivering. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but owned by another user; only ESRCH means gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
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
