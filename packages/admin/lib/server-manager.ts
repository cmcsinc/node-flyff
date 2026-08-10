/**
 * ServerManager — instance registry + config generation for the game servers.
 *
 * The child processes themselves are owned by the supervisor daemon
 * (`supervisor-daemon.ts`), NOT by this module — that is what lets the servers
 * keep running when the admin app is restarted or down. This module holds the
 * parts that belong to the admin side: the instance registry
 * (`config/instances.json`), the generated per-instance config files, and thin
 * async wrappers over the daemon API.
 *
 * Each managed instance gets a self-contained config file written to
 * `config/instances/<id>.json` and is booted with `CONFIG_FILE` pointing at it.
 * `loadConfig` treats CONFIG_FILE as the sole config layer (see
 * packages/core/src/config/loader.ts), which is what lets us run N cluster or
 * world servers off one repo without touching the committed config/*.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  clearLogs,
  fetchLogs,
  fetchStatuses,
  requestShutdown,
  requestStart,
  requestStop,
} from './supervisor-client';
import { CONFIG_DIR, ROOT, isValidInstanceId, stripAnsi } from './supervisor-shared';
import type { LogLine, ProcStatus, RunState, ServerType } from './supervisor-shared';

export { isValidInstanceId, stripAnsi, requestShutdown };
export type { ServerType, RunState, LogLine };

export interface ServerInstance {
  /** Slug + `server.id` for this process. Unique. */
  id: string;
  type: ServerType;
  label: string;
  /** Client-facing TCP port (`server.port`). */
  port: number;
  /** Boot this instance when the supervisor daemon starts (e.g. host reboot). */
  autoStart?: boolean;
  /** Deep-merged into the generated config, last-wins. */
  overrides?: Record<string, unknown>;
}

export interface InstanceStatus extends ServerInstance, ProcStatus {
  /** Merged config the process would boot with (defaults → base → derived → overrides). */
  effective?: Record<string, unknown>;
  /** Same merge without overrides — rendered as form placeholders. */
  inherited?: Record<string, unknown>;
}

const INSTANCES_FILE = resolve(CONFIG_DIR, 'instances.json');
const GENERATED_DIR = resolve(CONFIG_DIR, 'instances');

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

/**
 * Builds the self-contained config object for an instance.
 * Layers: committed default.json → <type>-server.json → derived → overrides.
 */
export function buildInstanceConfig(inst: ServerInstance, defaults: Plain, base: Plain): Plain {
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
      label: `${type[0].toUpperCase()}${type.slice(1)} Server 1`,
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

/**
 * Effective config for an instance = what `writeInstanceConfig` would emit,
 * plus the committed base (no overrides) so the form can show "inherited"
 * values as placeholders.
 */
export function readInstanceConfig(inst: ServerInstance): { effective: Plain; inherited: Plain } {
  const defaults = readJson(resolve(CONFIG_DIR, 'default.json'));
  const base = readJson(resolve(CONFIG_DIR, BASE_CONFIG[inst.type]));
  const inherited = buildInstanceConfig({ ...inst, overrides: {} }, defaults, base);
  return { effective: buildInstanceConfig(inst, defaults, base), inherited };
}

// ---------------------------------------------------------------------------
// Daemon-backed status / lifecycle
// ---------------------------------------------------------------------------

const STOPPED: ProcStatus = { state: 'stopped', pid: null, startedAt: null, exitCode: null };

/**
 * Registry rows joined with live process state from the daemon. The daemon is
 * the sole source of truth for `state`/`pid`, so this survives an admin
 * restart: whatever was running before is still reported as running.
 */
export async function getStatuses(): Promise<InstanceStatus[]> {
  const procs = await fetchStatuses();
  return listInstances().map((inst) => {
    const { effective, inherited } = readInstanceConfig(inst);
    return { ...inst, ...(procs[inst.id] ?? STOPPED), effective, inherited };
  });
}

export async function isRunning(id: string): Promise<boolean> {
  const st = (await fetchStatuses())[id];
  return st.state === 'running' || st.state === 'starting';
}

export function getLogs(id: string, since = 0, wait = false): Promise<LogLine[]> {
  return fetchLogs(id, since, wait);
}

/**
 * Clears the daemon's buffer for `id`.
 *
 * Clearing browser state alone is not a clear: the next page load re-reads the
 * daemon ring from seq 0 and the "cleared" lines come back.
 */
export function clearInstanceLogs(id: string): Promise<{ ok: true } | { error: string }> {
  return clearLogs(id);
}

/** Boots an instance in the daemon (survives admin restarts). */
export async function startInstance(id: string): Promise<InstanceStatus | { error: string }> {
  const inst = listInstances().find((i) => i.id === id);
  if (!inst) return { error: `Unknown instance: ${id}` };

  const configFile = writeInstanceConfig(inst);
  const res = await requestStart({ id: inst.id, type: inst.type, configFile });
  if ('error' in res) return res;
  return { ...inst, ...res.status };
}

/** Graceful stop, escalating to SIGKILL after the daemon's grace window. */
export function stopInstance(id: string): Promise<{ ok: true } | { error: string }> {
  return requestStop(id);
}

export { ROOT };
