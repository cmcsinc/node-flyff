/**
 * NPC placement write path.
 *
 * The point of these: the zone files carry hand-written header + region
 * comments, and the old `stringify(parse(file))` shape would silently delete
 * them. Each case runs against a temp copy of a minimal zone file.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { writeNpcToFile, deleteNpcFromFile, nextNpcId, parseNpcRef, blankNpc } from '../lib/npcs';

const ZONE_YAML = `# worlds/zones/test.yml
# Hand-written header that must survive edits.
_version: "1.0"
_id: test
name: Test
npcs:
  # a leading comment inside the sequence
  - id: 1
    mover_id: 220
    character_key: MaFl_DrEstern
    position:
      x: 1
      y: 2
      z: 3
    angle: 0
    functions: []
  - id: 3
    mover_id: 200
    position:
      x: 4
      y: 5
      z: 6
    angle: 1.5
    functions: []
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'npc-test-'));
  file = join(dir, 'test.yml');
  writeFileSync(file, ZONE_YAML, 'utf-8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function npcs(): Record<string, unknown>[] {
  return parseYaml(readFileSync(file, 'utf-8')).npcs;
}

describe('parseNpcRef', () => {
  it('splits zone and id', () => {
    assert.deepEqual(parseNpcRef('flaris:12'), { zoneId: 'flaris', npcId: 12 });
  });

  it('maps :new to a null id', () => {
    assert.deepEqual(parseNpcRef('flaris:new'), { zoneId: 'flaris', npcId: null });
  });

  it('rejects malformed refs', () => {
    for (const bad of ['', 'flaris', ':12', 'flaris:', 'flaris:0', 'flaris:-1', 'flaris:x']) {
      assert.equal(parseNpcRef(bad), null, bad);
    }
  });
});

describe('nextNpcId', () => {
  it('fills the lowest gap', () => {
    assert.equal(nextNpcId([1, 3]), 2);
    assert.equal(nextNpcId([1, 2, 3]), 4);
    assert.equal(nextNpcId([]), 1);
  });
});

describe('writeNpcToFile', () => {
  it('preserves file comments', () => {
    writeNpcToFile(file, 1, { ...blankNpc(), mover_id: 999, position: { x: 9, y: 9, z: 9 } });
    const text = readFileSync(file, 'utf-8');
    assert.match(text, /# Hand-written header that must survive edits\./);
    assert.match(text, /# a leading comment inside the sequence/);
  });

  it('replaces in place without changing the count', () => {
    writeNpcToFile(file, 1, { ...blankNpc(), mover_id: 999, position: { x: 9, y: 9, z: 9 } });
    const list = npcs();
    assert.equal(list.length, 2);
    assert.equal(list.find((n) => n.id === 1)!.mover_id, 999);
  });

  it('appends with the next free id when npcId is null', () => {
    const id = writeNpcToFile(file, null, blankNpc());
    assert.equal(id, 2);
    assert.equal(npcs().length, 3);
    assert.equal(npcs().find((n) => n.id === 2)!.mover_id, 1);
  });

  it('rejects an invalid placement before it reaches disk', () => {
    const before = readFileSync(file, 'utf-8');
    assert.throws(() => writeNpcToFile(file, 1, { ...blankNpc(), mover_id: 0 }));
    assert.throws(() => writeNpcToFile(file, 1, { ...blankNpc(), angle: 99 }));
    assert.equal(readFileSync(file, 'utf-8'), before);
  });
});

describe('deleteNpcFromFile', () => {
  it('removes only the target', () => {
    assert.equal(deleteNpcFromFile(file, 1), true);
    assert.deepEqual(
      npcs().map((n) => n.id),
      [3],
    );
  });

  it('returns false for an unknown id and leaves the file alone', () => {
    const before = readFileSync(file, 'utf-8');
    assert.equal(deleteNpcFromFile(file, 77), false);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });
});
