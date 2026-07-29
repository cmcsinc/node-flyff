/**
 * ServerManager — spawns / stops / monitors game-server child processes.
 *
 * Each managed instance gets a self-contained config file written to
 * `config/instances/<id>.json` and is booted with `CONFIG_FILE` pointing at it.
 * `loadConfig` treats CONFIG_FILE as the sole config layer (see
 * packages/core/src/config/loader.ts), which is what lets us run N cluster or
 * world servers off one repo without touching the committed config/*.json.
 *
 * State lives on `globalThis` so Next.js dev HMR does not orphan children.
 *
 * ponytail: single-host supervisor (no docker/pm2, no remote hosts). Upgrade
 * path = swap spawnInstance/stopInstance for a container/pm2 driver.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ServerType = 'login' | 'cluster' | 'world';
export type RunState = 'stopped' | 'starting' | 'running' | 'exited';

export interface ServerInstance {
  /** Slug + `server.id` for this process. Unique. */
  id: string;
  type: ServerType;
  label: string;
  /** Client-facing TCP port (`server.port`). */
  port: number;
  /** Deep-merged into the generated config, last-wins. */
  overrides?: Record<string, unknown>;
}

export interface LogLine {
  seq: number;
  ts: number;
  line: string;
}

export interface InstanceStatus extends ServerInstance {
  state: RunState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_DIR = resolve(ROOT, 'config');
const INSTANCES_FILE = resolve(CONFIG_DIR, 'instances.json');
const GENERATED_DIR = resolve(CONFIG_DIR, 'instances');
const LOG_RING = 500;

const ENTRY: Record<ServerType, string> = {
  login: 'packages/login-server/src/index.ts',
  cluster: 'packages/cluster-server/src/index.ts',
  world: 'packages/world-server/src/index.ts',
};

/** Config file name the committed per-type defaults live in. */
const BASE_CONFIG: Record<ServerType, string> = {
  login: 'login-server.json',
  cluster: 'cluster-server.json',
  world: 'world-server.json',
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested — see test/server-manager.test.ts)
// ---------------------------------------------------------------------------

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Recursive last-wins merge. Arrays and scalars are replaced, not merged. */
export function deepMerge(...layers: Plain[]): Plain {
  const out: Plain = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
    }
  }
  return out;
}

/** `id` must be filesystem- and `server.id`-safe. */
export function isValidInstanceId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{1,31}$/i.test(id);
}

/** Drops ANSI colour codes so log lines render cleanly in the browser. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

/**
 * Builds the self-contained config object for an instance.
 * Layers: committed default.json → <type>-server.json → derived → overrides.
 */
export function buildInstanceConfig(
  inst: ServerInstance,
  defaults: Plain,
  base: Plain,
): Plain {
  const derived: Plain = {
    server: { id: inst.id, port: inst.port },
  };
  if (inst.type === 'world') {
    // Each world needs its own WAL journal or two processes fight over one file.
    derived.wal = { journalPath: `./data/${inst.id}_journal.sqlite3` };
  }
  return deepMerge(defaults, base, derived, (inst.overrides ?? {}) as Plain);
}

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

function readJson(path: string): Plain {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return isPlain(parsed) ? parsed : {};
}

/** Seeded from the committed configs so the panel is useful on first open. */
function seedInstances(): ServerInstance[] {
  const seed: ServerInstance[] = [];
  for (const type of ['login', 'cluster', 'world'] as ServerType[]) {
    const base = readJson(resolve(CONFIG_DIR, BASE_CONFIG[type]));
    const server = isPlain(base.server) ? base.server : {};
    seed.push({
      id: typeof server.id === 'string' ? server.id : `${type}_1`,
      type,
      label: `${type[0]!.toUpperCase()}${type.slice(1)} Server 1`,
      port: typeof server.port === 'number' ? server.port : 0,
    });
  }
  return seed;
}

export function listInstances(): ServerInstance[] {
  const raw = readJson(INSTANCES_FILE);
  if (!Array.isArray(raw.instances)) {
    const seeded = seedInstances();
    saveInstances(seeded);
    return seeded;
  }
  return raw.instances as ServerInstance[];
}

export function saveInstances(instances: ServerInstance[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(INSTANCES_FILE, `${JSON.stringify({ instances }, null, 2)}\n`, 'utf-8');
}

/** Writes `config/instances/<id>.json` and returns its absolute path. */
export function writeInstanceConfig(inst: ServerInstance): string {
  const defaults = readJson(resolve(CONFIG_DIR, 'default.json'));
  const base = readJson(resolve(CONFIG_DIR, BASE_CONFIG[inst.type]));
  const merged = buildInstanceConfig(inst, defaults, base);
  mkdirSync(GENERATED_DIR, { recursive: true });
  const path = resolve(GENERATED_DIR, `${inst.id}.json`);
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  return path;
}

/** Minimal `.env` reader — same contract as scripts/start-servers.mjs. */
function loadDotEnv(): Record<string, string> {
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

// ---------------------------------------------------------------------------
// Live process registry (globalThis-backed so HMR keeps children)
// ---------------------------------------------------------------------------

interface Running {
  child: ChildProcess;
  state: RunState;
  startedAt: number;
  exitCode: number | null;
}

interface ManagerState {
  procs: Map<string, Running>;
  logs: Map<string, LogLine[]>;
  subs: Map<string, Set<(l: LogLine) => void>>;
  seq: number;
}

const g = globalThis as unknown as { __flyffServerManager?: ManagerState };
const state: ManagerState =
  g.__flyffServerManager ??
  (g.__flyffServerManager = { procs: new Map(), logs: new Map(), subs: new Map(), seq: 0 });

function pushLog(id: string, raw: string): void {
  const ring = state.logs.get(id) ?? [];
  for (const l of stripAnsi(raw).split(/\r?\n/)) {
    if (!l.length) continue;
    const entry: LogLine = { seq: ++state.seq, ts: Date.now(), line: l };
    ring.push(entry);
    for (const fn of state.subs.get(id) ?? []) fn(entry);
  }
  if (ring.length > LOG_RING) ring.splice(0, ring.length - LOG_RING);
  state.logs.set(id, ring);
}

export function getLogs(id: string): LogLine[] {
  return state.logs.get(id) ?? [];
}

export function subscribeLogs(id: string, fn: (l: LogLine) => void): () => void {
  const set = state.subs.get(id) ?? new Set();
  set.add(fn);
  state.subs.set(id, set);
  return () => set.delete(fn);
}

export function getStatuses(): InstanceStatus[] {
  return listInstances().map((inst) => {
    const run = state.procs.get(inst.id);
    return {
      ...inst,
      state: run?.state ?? 'stopped',
      pid: run?.child.pid ?? null,
      startedAt: run?.startedAt ?? null,
      exitCode: run?.exitCode ?? null,
    };
  });
}

export function isRunning(id: string): boolean {
  const run = state.procs.get(id);
  return run !== undefined && (run.state === 'running' || run.state === 'starting');
}

/**
 * Boots an instance. Runs the TS entry in-process via `node --import tsx`
 * (no shell, no intermediate tsx CLI child) so kill() reliably reaches it.
 */
export function startInstance(id: string): InstanceStatus | { error: string } {
  const inst = listInstances().find((i) => i.id === id);
  if (!inst) return { error: `Unknown instance: ${id}` };
  if (isRunning(id)) return { error: `${id} is already running` };

  const configFile = writeInstanceConfig(inst);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...loadDotEnv(),
    CONFIG_FILE: configFile,
    SERVER_ID: inst.id,
    LOG_PRETTY: '1',
  };
  if (!env.DB_FILENAME) env.DB_FILENAME = './data/flyff_dev.sqlite3';

  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY[inst.type]], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const run: Running = { child, state: 'starting', startedAt: Date.now(), exitCode: null };
  state.procs.set(id, run);
  pushLog(id, `[manager] spawned pid=${child.pid ?? '?'} config=${configFile}`);

  child.stdout?.on('data', (c: Buffer) => {
    run.state = 'running';
    pushLog(id, c.toString());
  });
  child.stderr?.on('data', (c: Buffer) => pushLog(id, c.toString()));
  child.on('error', (err) => pushLog(id, `[manager] spawn error: ${err.message}`));
  child.on('exit', (code, signal) => {
    run.state = 'exited';
    run.exitCode = code;
    pushLog(id, `[manager] exited code=${code} signal=${signal ?? 'none'}`);
  });

  return { ...inst, state: run.state, pid: child.pid ?? null, startedAt: run.startedAt, exitCode: null };
}

/** Graceful stop, escalating to SIGKILL after `graceMs`. */
export function stopInstance(id: string, graceMs = 4000): { ok: true } | { error: string } {
  const run = state.procs.get(id);
  if (!run || run.state === 'exited') return { error: `${id} is not running` };
  pushLog(id, '[manager] stopping…');
  run.child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (run.state !== 'exited') {
      pushLog(id, '[manager] grace expired — SIGKILL');
      run.child.kill('SIGKILL');
    }
  }, graceMs);
  timer.unref?.();
  return { ok: true };
}
