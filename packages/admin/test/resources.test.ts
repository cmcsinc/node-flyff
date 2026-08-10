/**
 * `entryMatches` — the id/key resolution the drop editor depends on.
 *
 * Drop tables have no numeric `id`; they are keyed by the `MI_*` mover symbol.
 * Items/movers/skills carry both, and must keep matching on `id`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { entryMatches } from '../lib/resources';

describe('entryMatches', () => {
  it('matches a drop table by its MI_* key', () => {
    assert.equal(entryMatches({ key: 'MI_AIBATT1', modelIdx: 20 }, 'MI_AIBATT1'), true);
    assert.equal(entryMatches({ key: 'MI_AIBATT1', modelIdx: 20 }, 'MI_AIBATT2'), false);
  });

  it('prefers id when the entry has both', () => {
    assert.equal(entryMatches({ id: 20, key: 'MI_AIBATT1' }, '20'), true);
    assert.equal(entryMatches({ id: 20, key: 'MI_AIBATT1' }, 'MI_AIBATT1'), true);
    assert.equal(entryMatches({ id: 20, key: 'MI_AIBATT1' }, '21'), false);
  });

  it('does not match a numeric id against a non-string key', () => {
    assert.equal(entryMatches({ key: 20 }, '20'), false);
  });

  it('does not match an entry with neither id nor key', () => {
    assert.equal(entryMatches({ modelIdx: 20 }, '20'), false);
  });
});
