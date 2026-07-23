/**
 * Smoke test for scripts/extractFlaris.ts -- verifies the canonical .dyo/.rgn
 * port landed in data/worlds/zones/flaris.yml with sane NPC/spawn counts.
 *
 * @module test/extractFlaris.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllResources } from '../src/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, '../data');

describe('extractFlaris canonical port', () => {
  it('flaris.yml carries many more NPCs than the legacy hand-authored 5', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris');
    assert.ok(flaris, 'flaris zone exists');
    assert.ok(flaris!.npcs.length > 5, `expected > 5 NPCs from .dyo port, got ${flaris!.npcs.length}`);
    assert.ok(flaris!.spawns.length > 50, `expected many .rgn spawn regions, got ${flaris!.spawns.length}`);
  });

  it('town NPC Marche (MI_MAFL_MARCHE=214) is placed by the .dyo port', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris')!;
    assert.ok(
      flaris.npcs.some((n) => n.mover_id === 214),
      'Marche (MI 214) should be among the placed town NPCs',
    );
  });

  it('every spawn references a real monster MI (converter-filtered)', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris')!;
    for (const s of flaris.spawns) {
      assert.ok(resources.movers.movers.has(s.mover_id), `spawn ${s.id} -> MI ${s.mover_id}`);
    }
  });
});
