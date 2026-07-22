#!/usr/bin/env tsx
/**
 * generateIndexes -- scan domain `.yml` files and emit `_index.yml` per domain.
 *
 * Each `_index.yml` is a `Record<id, { file, name }>` consumed by the loaders in
 * `src/loaders/`. With an index present the loader reads only the referenced
 * files instead of scanning the whole directory; without one it falls back to
 * the scan (and logs a warn). This script regenerates indexes after the
 * underlying data files change.
 *
 * Workflow: edit a file under `data/` -> `pnpm generate:indexes` -> indexes refreshed.
 *
 * Usage: pnpm generate:indexes
 *
 * @module scripts/generateIndexes
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(PKG_ROOT, 'data');

/** Domain -> wrapper key that holds the entity array. */
const DOMAINS = [
  { dir: 'items', key: 'items' },
  { dir: 'movers', key: 'movers' },
  { dir: 'skills', key: 'skills' },
] as const;

type Entity = { id: number; name: string };
type IndexEntry = { file: string; name: string };

/** Scan one domain dir and build a stable, numerically-sorted id->entry map. */
async function buildIndex(dirPath: string, key: string): Promise<Record<string, IndexEntry>> {
  const files = (await readdir(dirPath))
    .filter((f) => f.endsWith('.yml') && f !== '_index.yml')
    .sort();

  const byId = new Map<number, IndexEntry>();
  for (const file of files) {
    const data = parse(await readFile(resolve(dirPath, file), 'utf-8'));
    const list: Entity[] = data?.[key] ?? [];
    for (const entity of list) {
      byId.set(entity.id, { file, name: entity.name });
    }
  }

  const out: Record<string, IndexEntry> = {};
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    out[String(id)] = byId.get(id)!;
  }
  return out;
}

async function main(): Promise<void> {
  console.log('[reload] Generating _index.yml files');

  for (const { dir, key } of DOMAINS) {
    const dirPath = resolve(DATA_DIR, dir);
    const entries = await buildIndex(dirPath, key);
    await writeFile(resolve(dirPath, '_index.yml'), stringify(entries), 'utf-8');
    console.log(`   ${dir}/_index.yml: ${Object.keys(entries).length} entries`);
  }

  console.log('[OK] Index generation complete');
}

main().catch((err) => {
  console.error('[FAIL] Index generation failed:', err);
  process.exit(1);
});
