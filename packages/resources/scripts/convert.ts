#!/usr/bin/env tsx
/**
 * txt -> yml resource converter.
 *
 * Reads the original Flyff resource files from `raw/` (an editable snapshot of
 * `game/resource/`) and regenerates the YAML under `data/`.
 *
 * Workflow: edit a file in `raw/` -> run `pnpm convert` -> `data/*.yml` refreshed.
 * The client keeps reading the originals from `game/resource/` untouched.
 *
 * Usage: pnpm convert
 *
 * @module scripts/convert
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMovers } from './converters/movers.js';
import { convertItems } from './converters/items.js';
import { convertSkills } from './converters/skills.js';
import { convertDialogs } from './converters/dialogs.js';
import { convertQuests } from './converters/quests.js';
import { convertDrops } from './converters/drops.js';
import { convertSetItems } from './converters/setItems.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const RAW_DIR = resolve(PKG_ROOT, 'raw');
const DATA_DIR = resolve(PKG_ROOT, 'data');

async function main(): Promise<void> {
  console.log('[reload] Converting raw/ -> data/');
  console.log(`   raw:  ${RAW_DIR}`);
  console.log(`   data: ${DATA_DIR}`);

  await Promise.all([
    convertMovers(RAW_DIR, DATA_DIR),
    convertItems(RAW_DIR, DATA_DIR),
    convertSkills(RAW_DIR, DATA_DIR),
    convertDialogs(RAW_DIR, DATA_DIR),
    convertQuests(RAW_DIR, DATA_DIR),
    convertDrops(RAW_DIR, DATA_DIR),
    convertSetItems(RAW_DIR, DATA_DIR),
  ]);

  console.log('[OK] Conversion complete');
}

main().catch((err) => {
  console.error('[FAIL] Conversion failed:', err);
  process.exit(1);
});
