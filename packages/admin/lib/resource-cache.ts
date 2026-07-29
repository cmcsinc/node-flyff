/**
 * Process-wide resource cache.
 *
 * The admin panel used to re-read + re-parse `packages/resources/data` on every
 * request: three separate `loadAllResources()` singletons (item/skill/quest
 * catalog) plus a `readdirSync` + YAML parse per resource list page. This module
 * is the single owner of both — loaded once per server process, warmed at boot
 * from `instrumentation.ts`, invalidated only when the editor writes a file.
 *
 * State lives on `globalThis` so it survives Next dev HMR module re-evaluation.
 *
 * @module lib/resource-cache
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { loadAllResources, type ResourceIndex } from "@flyff/resources";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/** Parsed+validated resource index directory (`@flyff/resources` loaders). */
export const DATA_DIR = resolve(REPO_ROOT, "packages", "resources", "data");

/** One parsed YAML file plus the absolute path it came from. */
export interface YamlDoc {
  file: string;
  doc: Record<string, unknown>;
}

interface CacheState {
  index: Promise<ResourceIndex> | null;
  /** Raw YAML docs per resource directory, keyed by directory name. */
  yamlDirs: Map<string, YamlDoc[]>;
}

const g = globalThis as typeof globalThis & { __flyffResourceCache?: CacheState };
const cache: CacheState = (g.__flyffResourceCache ??= { index: null, yamlDirs: new Map() });

/** The shared `ResourceIndex`. Loaded on first call, then reused forever. */
export function getResourceIndex(): Promise<ResourceIndex> {
  // Clear a rejected load so a transient failure isn't cached for process life.
  cache.index ??= loadAllResources(DATA_DIR).catch((err: unknown) => {
    cache.index = null;
    throw err;
  });
  return cache.index;
}

// --- Raw YAML directory reads (resource browser/editor pages) -----------------

function readYamlFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = parseYaml(readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * All YAML docs in a resource subdirectory (relative to `DATA_DIR`), cached.
 * `_`-prefixed files (indexes) are skipped, matching the loaders.
 */
export function getYamlDir(dir: string): YamlDoc[] {
  const hit = cache.yamlDirs.get(dir);
  if (hit) return hit;

  const dirPath = join(DATA_DIR, dir);
  const docs: YamlDoc[] = !existsSync(dirPath)
    ? []
    : readdirSync(dirPath)
        .filter((f) => f.endsWith(".yml") && !f.startsWith("_"))
        .map((f) => {
          const file = join(dirPath, f);
          const doc = readYamlFile(file);
          return doc ? { file, doc } : null;
        })
        .filter((d): d is YamlDoc => d !== null);

  cache.yamlDirs.set(dir, docs);
  return docs;
}

/** Drop all cached resource state. Call after any write to `resources/data`. */
export function invalidateResourceCache(): void {
  cache.index = null;
  cache.yamlDirs.clear();
}

/** Warm every cache up front so the first request pays no load cost. */
export async function warmResourceCache(dirs: readonly string[] = []): Promise<void> {
  for (const dir of dirs) getYamlDir(dir);
  await getResourceIndex();
}
