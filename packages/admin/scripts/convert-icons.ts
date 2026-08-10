#!/usr/bin/env tsx
/**
 * One-time DDS -> PNG item-icon converter.
 *
 * Reads the icon filename (`icon:`) from every item definition, locates the
 * matching `.dds` texture under `game/client/`, decodes it, and writes a
 * lossless PNG into `admin/public/icons/`. The browser serves these statically,
 * so the inventory UI gets real game art with zero runtime decode cost and no
 * native image dep shipped to the app.
 *
 * Incremental: skips a file whose PNG already exists and is newer than its
 * source `.dds`, unless `--force`. Logs a summary plus any missing/failed icons.
 *
 * Usage:  pnpm icons:convert          # incremental
 *         pnpm icons:convert:force    # re-decode everything
 *
 * @module scripts/convert-icons
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllResources } from '@flyff/resources';
import { decodeDds, encodePng, applyColorKey } from './dds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');

const DATA_DIR = resolve(REPO_ROOT, 'packages/resources/data');
const OUT_DIR = resolve(PKG_ROOT, 'public', 'icons');

// Search order for the source .dds -- Item/ holds most icons, Model/Texture/
// holds weapon/armor skins, SFX/Texture/ a few effect icons.
const DDS_DIRS = [
  resolve(REPO_ROOT, 'game/client/Item'),
  resolve(REPO_ROOT, 'game/client/Model/Texture'),
  resolve(REPO_ROOT, 'game/client/SFX/Texture'),
];

const FORCE = process.argv.includes('--force');

interface Tally {
  converted: number;
  skipped: number;
  missing: number;
  failed: number;
}

async function findDds(icon: string): Promise<string | null> {
  for (const dir of DDS_DIRS) {
    const candidate = join(dir, icon);
    if (existsSync(candidate)) return candidate;
  }
  // Pet cages ship per-grade art only: `Itm_PetUnicorn01_00/_01/_02.dds` with no
  // base file. The client rewrites the name at draw time from the pet's level
  // (`game/source/_Common/Item.cpp:95-111`); with no pet instance in the admin
  // panel, fall back to the lowest grade (`_00`, PL_D/PL_C).
  const graded = icon.replace(/(\.dds)$/i, '_00$1');
  for (const dir of DDS_DIRS) {
    const candidate = join(dir, graded);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function main(): Promise<void> {
  console.log('[icons] Loading item definitions...');
  const resources = await loadAllResources(DATA_DIR);
  const items = [...resources.items.items.values()].filter((it) => it.icon);
  console.log(`[icons] ${String(items.length)} items reference an icon; output -> ${OUT_DIR}`);

  await mkdir(OUT_DIR, { recursive: true });

  const tally: Tally = { converted: 0, skipped: 0, missing: 0, failed: 0 };
  const missing: string[] = [];
  const failed: string[] = [];

  for (const item of items) {
    const icon = item.icon!;
    const pngName = icon.replace(/\.dds$/i, '.png');
    const outPath = join(OUT_DIR, pngName);

    const ddsPath = await findDds(icon);
    if (!ddsPath) {
      tally.missing++;
      missing.push(`${String(item.id)} ${item.name} -> ${icon}`);
      continue;
    }

    if (!FORCE && existsSync(outPath)) {
      const [srcMtime, outMtime] = await Promise.all([stat(ddsPath), stat(outPath)]);
      if (outMtime.mtimeMs >= srcMtime.mtimeMs) {
        tally.skipped++;
        continue;
      }
    }

    try {
      const buf = await readFile(ddsPath);
      const img = applyColorKey(decodeDds(buf));
      const png = encodePng(img);
      await writeFile(outPath, png);
      tally.converted++;
    } catch (err) {
      tally.failed++;
      failed.push(`${String(item.id)} ${item.name} (${icon}): ${(err as Error).message}`);
    }
  }

  console.log('\n[icons] done:', JSON.stringify(tally));
  if (missing.length) {
    console.warn(`[icons] ${String(missing.length)} icons had no source .dds (first 10):`);
    for (const m of missing.slice(0, 10)) console.warn('  -', m);
  }
  if (failed.length) {
    console.warn(`[icons] ${String(failed.length)} icons failed to decode (first 10):`);
    for (const f of failed.slice(0, 10)) console.warn('  -', f);
  }
}

main().catch((err) => {
  console.error('[icons] FAILED:', err);
  process.exit(1);
});
