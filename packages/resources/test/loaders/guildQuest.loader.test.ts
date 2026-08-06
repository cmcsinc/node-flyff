/**
 * `propGuildQuest.inc` loader tests.
 *
 * @module test/loaders/guildQuest.loader.test
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefines } from '../../src/loaders/defines.loader';
import { loadGuildQuest, parseGuildQuestInc, type GuildQuestIndex } from '../../src/loaders/guildQuest.loader';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = resolve(__dirname, '../../raw');

describe('guildQuest.loader', () => {
  let symbols: Map<string, number>;
  let index: GuildQuestIndex;

  before(async () => {
    symbols = await loadDefines(RAW_DIR);
    index = await loadGuildQuest(RAW_DIR, symbols);
  });

  it('parses exactly one entry, id resolved from QUEST_WARMON_LV1', () => {
    assert.equal(index.byId.size, 1);
    assert.equal(index.byKey.size, 1);
    const expectedId = symbols.get('QUEST_WARMON_LV1');
    assert.ok(expectedId !== undefined, 'QUEST_WARMON_LV1 defined in raw/define*.h');
    const prop = index.byKey.get('QUEST_WARMON_LV1');
    assert.ok(prop, 'entry indexed by symbol');
    assert.equal(prop.id, expectedId);
    assert.equal(index.byId.get(expectedId), prop);
  });

  it('resolves level, wormon and world', () => {
    const prop = index.byKey.get('QUEST_WARMON_LV1')!;
    assert.equal(prop.level, 70);
    assert.equal(prop.wormonId, symbols.get('MI_CLOCKWORK1'));
    assert.equal(prop.worldId, symbols.get('WI_WORLD_MADRIGAL'));
  });

  it('keeps Position float precision (no int truncation)', () => {
    const prop = index.byKey.get('QUEST_WARMON_LV1')!;
    assert.equal(prop.pos.x, 3892.785);
    assert.equal(prop.pos.y, 78.038);
    assert.equal(prop.pos.z, 3960.506);
  });

  it('keeps Region as written (Left, Top, Right, Bottom -- y1 > y2)', () => {
    const prop = index.byKey.get('QUEST_WARMON_LV1')!;
    assert.deepEqual(prop.region, { x1: 3787, y1: 4064, x2: 4000, y2: 3843 });
  });

  it('y-swaps Region into a non-empty rect (guildquest.cpp:270)', () => {
    const prop = index.byKey.get('QUEST_WARMON_LV1')!;
    assert.deepEqual(prop.rect, { left: 3787, top: 3843, right: 4000, bottom: 4064 });
    // Windows `PtInRect` needs left < right AND top < bottom, else the rect is
    // empty and no point ever tests inside. The swap is what makes it valid.
    assert.ok(prop.rect.left < prop.rect.right, 'left < right');
    assert.ok(prop.rect.top < prop.rect.bottom, 'top < bottom -- rect non-empty');
  });

  it('parses the three non-contiguous State desc entries (0, 1, 14)', () => {
    const prop = index.byKey.get('QUEST_WARMON_LV1')!;
    assert.deepEqual([...prop.desc.keys()].sort((a, b) => a - b), [0, 1, 14]);
    for (const state of [0, 1, 14]) {
      assert.ok((prop.desc.get(state) ?? '').length > 0, `State ${state} desc non-empty`);
    }
    assert.ok(prop.title.length > 0, 'Title parsed');
  });

  it('ignores the commented-out second Position line', () => {
    const prop = index.byKey.get('QUEST_WARMON_LV1')!;
    // `// Position = 3891.0, 30.0, 3968.0` must not win.
    assert.notEqual(prop.pos.x, 3891.0);
    assert.notEqual(prop.pos.y, 30.0);
    assert.notEqual(prop.pos.z, 3968.0);
  });

  it('skips a block whose quest symbol does not resolve, without throwing', () => {
    const props = parseGuildQuestInc('QUEST_NOT_A_REAL_SYMBOL\n{\n\tLevel = 5\n}\n', new Map());
    assert.deepEqual(props, []);
  });

  it('defaults missing keywords instead of throwing on a malformed block', () => {
    const props = parseGuildQuestInc(
      'QUEST_X\n{\n\tWorld = WI_NOPE\n\tWormon = MI_NOPE\n\tRegion = 1, 2\n\tState 3\n\t{\n\t}\n}\n',
      new Map([['QUEST_X', 42]]),
    );
    assert.equal(props.length, 1);
    const p = props[0]!;
    assert.equal(p.id, 42);
    assert.equal(p.title, '');
    assert.equal(p.level, 0);
    assert.equal(p.worldId, 0, 'unresolved World -> 0');
    assert.equal(p.wormonId, 0, 'unresolved Wormon -> 0');
    assert.deepEqual(p.region, { x1: 0, y1: 0, x2: 0, y2: 0 }, 'short Region -> all zeros');
    assert.deepEqual(p.pos, { x: 0, y: 0, z: 0 }, 'absent Position -> all zeros');
    assert.equal(p.desc.get(3), '', 'State without desc -> empty string');
  });

  it('does not treat a `//` inside a quoted string as a comment', () => {
    const props = parseGuildQuestInc('QUEST_X\n{\n\tTitle = "a//b"\n}\n', new Map([['QUEST_X', 1]]));
    assert.equal(props[0]?.title, 'a//b');
  });
});
