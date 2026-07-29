#!/usr/bin/env tsx
/**
 * DDS -> PNG skill-icon converter.
 *
 * Reads the icon filename from every skill definition in @flyff/resources,
 * locates the matching `.dds` texture under `game/client/Icon/`, decodes it,
 * and writes a lossless PNG into `admin/public/icons/`. Same pattern as
 * {@link ./convert-icons.ts} but for skill art instead of item art.
 *
 * Incremental: skips a file whose PNG already exists and is newer than its
 * source `.dds`, unless `--force`.
 *
 * Usage:  pnpm skills:convert          # incremental
 *         pnpm skills:convert:force    # re-decode everything
 *
 * @module scripts/convert-skill-icons
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

const DATA_DIR = resolve(REPO_ROOT, 'packages', 'resources', 'data');
const OUT_DIR = resolve(PKG_ROOT, 'public', 'icons');

// Skill icons live in `game/client/Icon/` alongside the propItem icons.
const DDS_DIRS = [
  resolve(REPO_ROOT, 'game', 'client', 'Icon'),
  resolve(REPO_ROOT, 'game', 'client', 'SFX', 'Texture'),
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
  return null;
}

async function main(): Promise<void> {
  console.log('[skill-icons] Loading skill definitions...');
  const resources = await loadAllResources(DATA_DIR);
  const skills = [...resources.skills.skills.values()].filter((s) => s.icon);
  console.log(`[skill-icons] ${skills.length} skills reference an icon; output -> ${OUT_DIR}`);

  await mkdir(OUT_DIR, { recursive: true });

  const tally: Tally = { converted: 0, skipped: 0, missing: 0, failed: 0 };
  const missing: string[] = [];
  const failed: string[] = [];

  for (const skill of skills) {
    const icon = skill.icon!;
    const pngName = icon.replace(/\.dds$/i, '.png');
    const outPath = join(OUT_DIR, pngName);

    const ddsPath = await findDds(icon);
    if (!ddsPath) {
      tally.missing++;
      missing.push(`${skill.id} ${skill.name} -> ${icon}`);
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
      failed.push(`${skill.id} ${skill.name} (${icon}): ${(err as Error).message}`);
    }
  }

  console.log('\n[skill-icons] done:', JSON.stringify(tally));
  if (missing.length) {
    console.warn(`[skill-icons] ${missing.length} icons had no source .dds (first 10):`);
    for (const m of missing.slice(0, 10)) console.warn('  -', m);
  }
  if (failed.length) {
    console.warn(`[skill-icons] ${failed.length} icons failed to decode (first 10):`);
    for (const f of failed.slice(0, 10)) console.warn('  -', f);
  }
}

main().catch((err) => {
  console.error('[skill-icons] FAILED:', err);
  process.exit(1);
});
