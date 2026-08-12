/**
 * ConfigLoader -- loads, merges, and validates server configuration.
 *
 * ## Resolution order (lowest -> highest priority)
 * 1. `config/default.json` or `config/default.yml`   -- committed safe defaults
 * 2. `config/<serverName>.json` or `.yml`            -- per-server committed overrides
 * 3. `config/<serverName>.local.json` or `.local.yml`-- local machine overrides (gitignored)
 * 4. `process.env` overrides                         -- secrets / 12-factor / Docker
 *
 * ## Config file wins for all non-secret fields.
 * Environment variables only override these specific secret/infra fields:
 *   `ipc.secret`, `database.url`, `cache.redisUrl`, `server.id`
 *
 * If `process.env.CONFIG_FILE` is set it is used as the sole config file path,
 * skipping the discovery chain (useful for Docker volumes / K8s ConfigMaps).
 *
 * @module config/loader
 */

import fs from 'node:fs';
import path from 'node:path';
import type { output, ZodType } from 'zod';
import { deepMerge } from './merge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// YAML support (optional -- loaded lazily so JSON-only users pay zero cost)
// ---------------------------------------------------------------------------

/**
 * Lazily loads js-yaml. If it is not installed (should not happen -- it is a
 * declared dep) we throw a descriptive error so the operator knows what to do.
 */
async function parseYaml(source: string): Promise<PlainObject> {
  let jsYaml: { load: (s: string) => unknown };
  try {
    jsYaml = await import('js-yaml');
  } catch {
    throw new Error(
      'js-yaml is required for YAML config files. Run: pnpm --filter @flyff/core add js-yaml',
    );
  }
  const parsed = jsYaml.load(source);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('YAML config file must contain a mapping (object) at the root level.');
  }
  return parsed as PlainObject;
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

/**
 * Reads and parses a single JSON or YAML config file.
 * Returns `null` if the file does not exist (non-existence is not an error).
 */
async function readConfigFile(filePath: string): Promise<PlainObject | null> {
  if (!fs.existsSync(filePath)) return null;

  const source = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    const parsed: unknown = JSON.parse(source);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError(`JSON config file must be an object: ${filePath}`);
    }
    return parsed as PlainObject;
  }

  if (ext === '.yml' || ext === '.yaml') {
    return parseYaml(source);
  }

  throw new TypeError(`Unsupported config file extension "${ext}" in: ${filePath}`);
}

// ---------------------------------------------------------------------------
// Env -> config path mapping
// ---------------------------------------------------------------------------

/**
 * Maps environment variable values onto the nested config object.
 * Only a whitelist of secret / infra fields can be overridden this way --
 * everything else is controlled by config files.
 *
 * Env vars that are undefined or empty string are silently skipped.
 */
function buildEnvOverrides(): PlainObject {
  const overrides: PlainObject = {};

  const set = (obj: PlainObject, keys: string[], value: string): void => {
    let cursor = obj;
    for (const k of keys.slice(0, -1)) {
      const next = cursor[k];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) cursor[k] = {};
      cursor = cursor[k] as PlainObject;
    }
    const last = keys.at(-1);
    if (last === undefined) return;
    cursor[last] = value;
  };

  const env = process.env;

  // Secrets / infra that MUST be injectable from the environment
  if (env['IPC_SECRET'])    set(overrides, ['ipc', 'secret'], env['IPC_SECRET']);
  if (env['DATABASE_URL'])  set(overrides, ['database', 'url'], env['DATABASE_URL']);
  if (env['REDIS_URL'])     set(overrides, ['cache', 'redisUrl'], env['REDIS_URL']);
  if (env['SERVER_ID'])     set(overrides, ['server', 'id'], env['SERVER_ID']);
  // Dev-only no-Redis LocalBus target (used when cache.adapter === 'memory').
  if (env['LOCAL_BUS_HOST']) set(overrides, ['ipc', 'localBusHost'], env['LOCAL_BUS_HOST']);
  if (env['LOCAL_BUS_PORT']) set(overrides, ['ipc', 'localBusPort'], env['LOCAL_BUS_PORT']);

  // DB client / filename (commonly set in docker-compose / .env for local dev)
  if (env['DB_CLIENT'])     set(overrides, ['database', 'client'], env['DB_CLIENT']);
  if (env['DB_FILENAME'])   set(overrides, ['database', 'filename'], env['DB_FILENAME']);

  return overrides;
}

// ---------------------------------------------------------------------------
// Discovery chain
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of config file paths to try, from lowest to
 * highest priority. Non-existent files are skipped by `readConfigFile`.
 */
function resolveFilePaths(serverName: string, configRoot: string): string[] {
  // If an explicit path is provided (Docker / K8s), use only that
  const explicit = process.env['CONFIG_FILE'];
  if (explicit) return [path.resolve(explicit)];

  return [
    path.join(configRoot, 'default.json'),
    path.join(configRoot, 'default.yml'),
    path.join(configRoot, `${serverName}.json`),
    path.join(configRoot, `${serverName}.yml`),
    path.join(configRoot, `${serverName}.local.json`),
    path.join(configRoot, `${serverName}.local.yml`),
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /**
   * Root directory that contains the config files.
   * Defaults to the first ancestor of cwd that contains a `config/` dir
   * (walked upward so `pnpm --filter <pkg> dev`, which runs from the package
   * dir, still resolves to the repo-root `config/`).
   */
  configRoot?: string;
}

/**
 * Walks upward from `start` (inclusive) to find the first directory that
 * contains a `config/` subdir. Returns the `config/` path, or `start/config`
 * if none found (preserves prior behavior as the fallback).
 */
function discoverConfigRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'config');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, 'config');
}

/**
 * Minimal stdlib `.env` loader (no new dependency). Parses `KEY=VALUE` lines
 * from `<repoRoot>/.env` and populates `process.env` for keys not already set
 * -- real environment wins, file only fills gaps. Runs once at config load so
 * `IPC_SECRET` / `DATABASE_URL` etc. reach the env-override layer below.
 */
function loadDotenv(repoRoot: string): void {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const source = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes: KEY="v" / KEY='v' -> v
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Loads, merges, and validates configuration for a named server.
 *
 * This function is **synchronous-friendly via a thin async wrapper** -- call it
 * once at startup (before `net.createServer()`). Never call it inside the
 * game loop.
 *
 * @param serverName - Logical server name matching config file names.
 *   e.g. `"login-server"`, `"cluster-server"`, `"world-server"`
 * @param schema - Zod schema to validate the merged config object.
 * @param options - Optional overrides for config root path.
 * @returns A fully validated, typed config object.
 *
 * @throws {Error} If no config files are found at all.
 * @throws {ZodError} If the merged config fails schema validation.
 *
 * @example
 * ```ts
 * import { loadConfig } from '@flyff/core/config';
 * import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
 *
 * const cfg = await loadConfig('world-server', WorldServerConfigSchema);
 * console.log(cfg.world.tickRateMs); // 50
 * ```
 */
export async function loadConfig<S extends ZodType>(
  serverName: string,
  schema: S,
  options: LoadConfigOptions = {},
): Promise<output<S>> {
  const configRoot = options.configRoot ?? discoverConfigRoot(process.cwd());
  loadDotenv(path.dirname(configRoot));
  const filePaths = resolveFilePaths(serverName, configRoot);

  // Read all config files in priority order
  const layers: PlainObject[] = [];
  let filesLoaded = 0;

  for (const filePath of filePaths) {
    const parsed = await readConfigFile(filePath);
    if (parsed !== null) {
      layers.push(parsed);
      filesLoaded++;
    }
  }

  if (filesLoaded === 0 && !process.env['CONFIG_FILE']) {
    // Not a hard error if env provides everything via IPC_SECRET etc., but
    // we warn loudly so the operator knows config files are missing.
    process.stderr.write(
      `[ConfigLoader] WARNING: No config files found for "${serverName}" in ${configRoot}.\n` +
      `  Expected one of:\n${filePaths.map(p => `    - ${p}`).join('\n')}\n` +
      `  Falling back to Zod defaults + env overrides only.\n`,
    );
  }

  // Env overrides are the highest-priority layer (secrets / infra)
  const envOverrides = buildEnvOverrides();

  const merged = deepMerge({}, ...layers, envOverrides);

  // Validate with the server-specific Zod schema
  const result = schema.safeParse(merged);

  if (!result.success) {
    const messages = result.error.errors
      .map(e => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(
      `[ConfigLoader] Invalid configuration for "${serverName}":\n${messages}\n\n` +
      `  Check your config files in: ${configRoot}`,
    );
  }

  // `output<S>` resolves to `any` on the unresolved type param (zod's ZodType
  // defaults Output = any); every real caller passes a concrete schema.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return result.data;
}

/**
 * Synchronous variant of {@link loadConfig} for contexts where top-level
 * await is not available. Reads only JSON files (YAML requires async import).
 *
 * Prefer {@link loadConfig} (async) whenever possible.
 */
export function loadConfigSync<S extends ZodType>(
  serverName: string,
  schema: S,
  options: LoadConfigOptions = {},
): output<S> {
  const configRoot = options.configRoot ?? discoverConfigRoot(process.cwd());
  loadDotenv(path.dirname(configRoot));
  const filePaths = resolveFilePaths(serverName, configRoot);

  const layers: PlainObject[] = [];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.json') {
      // YAML requires async -- skip in sync mode
      process.stderr.write(
        `[ConfigLoader] Skipping YAML file in sync mode: ${filePath}\n`,
      );
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(source);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      layers.push(parsed as PlainObject);
    }
  }

  const envOverrides = buildEnvOverrides();
  const merged = deepMerge({}, ...layers, envOverrides);

  const result = schema.safeParse(merged);
  if (!result.success) {
    const messages = result.error.errors
      .map(e => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(
      `[ConfigLoader] Invalid configuration for "${serverName}":\n${messages}`,
    );
  }

  // `output<S>` resolves to `any` on the unresolved type param (zod's ZodType
  // defaults Output = any); every real caller passes a concrete schema.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return result.data;
}
