/**
 * Client half of the supervisor. Imported by the admin app (server side only).
 *
 * `ensureDaemon()` starts the detached daemon on demand and is idempotent, so a
 * cold admin restart reattaches to the already-running daemon (and therefore to
 * the already-running game servers) instead of respawning anything.
 */

import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AUTH_HEADER,
  DAEMON_ENTRY,
  DEFAULT_PORT,
  LOG_DIR,
  ROOT,
  readHandle,
  readToken,
  type DaemonHandle,
  type LogLine,
  type ProcStatus,
} from './supervisor-shared';

const CONNECT_TIMEOUT_MS = 1500;
const BOOT_TIMEOUT_MS = 15_000;
/** Slightly past the daemon's 20s long-poll cap, so the hold isn't aborted. */
const LOG_WAIT_TIMEOUT_MS = 25_000;

/** In-flight ensureDaemon() promise, deduped across concurrent requests. */
const g = globalThis as unknown as { __flyffSupervisorBoot?: Promise<DaemonHandle | null> };

async function ping(port: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/health`, {
      headers: { [AUTH_HEADER]: token },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when a daemon is already reachable with the on-disk token. */
export async function daemonAlive(): Promise<boolean> {
  const token = readToken();
  if (!token) return false;
  return ping(readHandle()?.port ?? DEFAULT_PORT, token);
}

function spawnDaemon(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(resolve(LOG_DIR, 'supervisor.log'), 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', DAEMON_ENTRY], {
    cwd: ROOT,
    env: process.env,
    // Detached + no inherited stdio: the daemon must outlive this process.
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
}

/**
 * Guarantees a reachable daemon, spawning one if needed. Returns null if the
 * daemon could not be reached within BOOT_TIMEOUT_MS.
 */
export function ensureDaemon(): Promise<DaemonHandle | null> {
  return (g.__flyffSupervisorBoot ??= boot().finally(() => {
    delete g.__flyffSupervisorBoot;
  }));
}

async function boot(): Promise<DaemonHandle | null> {
  if (await daemonAlive()) return readHandle();
  spawnDaemon();
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (await daemonAlive()) return readHandle();
  }
  return null;
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = CONNECT_TIMEOUT_MS * 4,
): Promise<T | { error: string }> {
  const handle = await ensureDaemon();
  const token = readToken();
  if (!handle || !token) return { error: 'Supervisor daemon is not reachable' };
  try {
    const res = await fetch(`http://127.0.0.1:${String(handle.port)}${path}`, {
      method,
      headers: {
        [AUTH_HEADER]: token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await res.json();
    if (!res.ok) {
      const err = (json as { error?: string }).error;
      return { error: err ?? `Supervisor request failed (${String(res.status)})` };
    }
    return json as T;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Supervisor request failed' };
  }
}

export async function fetchStatuses(): Promise<Record<string, ProcStatus>> {
  const res = await call<{ procs: Record<string, ProcStatus> }>('GET', '/status');
  return 'error' in res ? {} : res.procs;
}

export async function fetchLogs(id: string, since = 0, wait = false): Promise<LogLine[]> {
  const res = await call<{ lines: LogLine[] }>(
    'GET',
    `/logs?id=${encodeURIComponent(id)}&since=${String(since)}${wait ? '&wait=1' : ''}`,
    undefined,
    // A waiting reader is meant to hang until output arrives; the daemon caps it
    // at 20s, so allow past that rather than aborting mid-hold.
    wait ? LOG_WAIT_TIMEOUT_MS : undefined,
  );
  return 'error' in res ? [] : res.lines;
}

/** Drops the daemon's in-memory ring for `id` — the only durable "clear". */
export function clearLogs(id: string): Promise<{ ok: true } | { error: string }> {
  return call('POST', '/logs/clear', { id });
}

export function requestStart(body: {
  id: string;
  type: string;
  configFile: string;
}): Promise<{ status: ProcStatus } | { error: string }> {
  return call<{ status: ProcStatus }>('POST', '/start', body);
}

export function requestStop(id: string): Promise<{ ok: true } | { error: string }> {
  return call<{ ok: true }>('POST', '/stop', { id });
}

/** Stops every child and exits the daemon. Only used by the CLI / operator. */
export function requestShutdown(): Promise<{ ok: true } | { error: string }> {
  return call<{ ok: true }>('POST', '/shutdown', {});
}
