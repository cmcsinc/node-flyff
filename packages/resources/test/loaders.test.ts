/**
 * Resource loader tests.
 *
 * @module test/loaders.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllResources, validateReferences } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, '../data');

describe('Resource Loaders', () => {
  it('should load all resources without errors', async () => {
    const resources = await loadAllResources(DATA_DIR);

    // Verify items loaded
    assert.ok(resources.items.items.size > 0, 'Items should be loaded');
    assert.ok(resources.items.byName.has('Rodney Axe'), 'Should have "Rodney Axe" item');

    // Verify movers loaded
    assert.ok(resources.movers.movers.size > 0, 'Movers should be loaded');
    assert.ok(resources.movers.byName.has('Small Aibatt'), 'Should have "Small Aibatt" mover');

    // Verify zones loaded
    assert.ok(resources.zones.zones.size > 0, 'Zones should be loaded');
    assert.ok(resources.zones.zones.has('flaris'), 'Should have "flaris" zone');
  });

  it('should validate cross-references', async () => {
    const resources = await loadAllResources(DATA_DIR);

    // Validate spawns and NPCs reference valid movers (should pass)
    const flaris = resources.zones.zones.get('flaris')!;

    for (const spawn of flaris.spawns) {
      assert.ok(resources.movers.movers.has(spawn.mover_id), `Spawn ${spawn.id} should reference valid mover`);
    }

    for (const npc of flaris.npcs) {
      assert.ok(resources.movers.movers.has(npc.mover_id), `NPC ${npc.id} should reference valid mover`);
    }
  });

  it('should load item with correct properties', async () => {
    const resources = await loadAllResources(DATA_DIR);
    // II_WEA_AXE_RODNEY=81 → "Rodney Axe"
    const rodney = resources.items.items.get(81);

    assert.ok(rodney, 'Rodney Axe should exist');
    assert.equal(rodney!.name, 'Rodney Axe');
    assert.equal(rodney!.attack, 29);
    assert.equal(rodney!.level_req, 1);
  });

  it('should load monster with correct properties', async () => {
    const resources = await loadAllResources(DATA_DIR);
    // MI_AIBATT1=20 → "Small Aibatt"
    const aibatt = resources.movers.movers.get(20);

    assert.ok(aibatt, 'Small Aibatt should exist');
    assert.equal(aibatt!.name, 'Small Aibatt');
    assert.equal(aibatt!.level, 1);
    assert.equal(aibatt!.hp, 120);
    assert.equal(aibatt!.dwObjIndex, 20);
  });

  it('should load zone with correct properties', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris');

    assert.ok(flaris, 'Flaris zone should exist');
    assert.equal(flaris!.name, 'Flaris');
    assert.equal(flaris!._id_numeric, 1);
    assert.equal(flaris!.world_id, 'madrigal');
    assert.ok(flaris!.spawns.length > 0, 'Should have spawns');
    assert.ok(flaris!.npcs.length > 0, 'Should have NPCs');
  });

  it('should validate zone spawn mover references', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris')!;

    for (const spawn of flaris.spawns) {
      const mover = resources.movers.movers.get(spawn.mover_id);
      assert.ok(mover, `Spawn ${spawn.id} should reference valid mover ${spawn.mover_id}`);
    }
  });

  it('should validate zone NPC mover references', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris')!;

    for (const npc of flaris.npcs) {
      const mover = resources.movers.movers.get(npc.mover_id);
      assert.ok(mover, `NPC ${npc.id} should reference valid mover ${npc.mover_id}`);
    }
  });

  it('should validate portal target zones', async () => {
    const resources = await loadAllResources(DATA_DIR);
    const flaris = resources.zones.zones.get('flaris')!;

    for (const portal of flaris.portals) {
      // Check portal format
      assert.ok(portal.target.zone, `Portal ${portal.id} should have target zone`);
      assert.ok(typeof portal.target.position.x === 'number', 'Portal target should have valid position');
    }
  });
});
