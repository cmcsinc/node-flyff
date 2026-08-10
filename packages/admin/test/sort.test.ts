import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseSort, sortRows, sortHref } from '../lib/sort';

const KEYS = ['id', 'name', 'level'] as const;

describe('parseSort', () => {
  it('accepts a known key and direction', () => {
    assert.deepEqual(parseSort('name', 'desc', KEYS), { key: 'name', dir: 'desc' });
  });

  it('defaults an unknown direction to asc', () => {
    assert.deepEqual(parseSort('name', 'sideways', KEYS), { key: 'name', dir: 'asc' });
  });

  it('rejects a key outside the allow-list rather than throwing', () => {
    assert.deepEqual(parseSort('password', 'asc', KEYS), { key: '', dir: 'asc' });
  });

  it('uses the fallback when no key is given', () => {
    assert.deepEqual(parseSort(undefined, undefined, KEYS, { key: 'id', dir: 'desc' }), {
      key: 'id',
      dir: 'desc',
    });
  });
});

interface Row {
  id: number;
  name: string;
  level: number;
}

const ROWS: Row[] = [
  { id: 3, name: 'beta', level: 10 },
  { id: 1, name: 'Alpha', level: 10 },
  { id: 2, name: 'gamma', level: 2 },
];

describe('sortRows', () => {
  it('returns the input untouched when no key is active', () => {
    const out = sortRows(ROWS, { key: '', dir: 'asc' });
    assert.deepEqual(
      out.map((r) => r.id),
      [3, 1, 2],
    );
  });

  it('sorts numbers numerically, not lexically', () => {
    const out = sortRows(ROWS, { key: 'level', dir: 'asc' });
    assert.deepEqual(
      out.map((r) => r.level),
      [2, 10, 10],
    );
  });

  it('sorts strings case-insensitively', () => {
    const out = sortRows(ROWS, { key: 'name', dir: 'asc' });
    assert.deepEqual(
      out.map((r) => r.name),
      ['Alpha', 'beta', 'gamma'],
    );
  });

  it('reverses on desc', () => {
    const out = sortRows(ROWS, { key: 'id', dir: 'desc' });
    assert.deepEqual(
      out.map((r) => r.id),
      [3, 2, 1],
    );
  });

  it('is stable across equal keys (original order preserved)', () => {
    const out = sortRows(ROWS, { key: 'level', dir: 'asc' });
    // Both level-10 rows tie; 3 came before 1 in the input and must stay there.
    assert.deepEqual(
      out.map((r) => r.id),
      [2, 3, 1],
    );
  });

  it('uses a custom accessor when provided', () => {
    const out = sortRows(ROWS, { key: 'name', dir: 'asc' }, { name: (r) => r.id });
    assert.deepEqual(
      out.map((r) => r.id),
      [1, 2, 3],
    );
  });

  it('does not mutate the input array', () => {
    const rows = [...ROWS];
    sortRows(rows, { key: 'id', dir: 'asc' });
    assert.deepEqual(
      rows.map((r) => r.id),
      [3, 1, 2],
    );
  });
});

describe('sortHref', () => {
  it('toggles asc → desc on the active column', () => {
    assert.equal(sortHref({}, 'name', { key: 'name', dir: 'asc' }), '?sort=name&dir=desc');
  });

  it('resets to asc when switching column', () => {
    assert.equal(sortHref({}, 'id', { key: 'name', dir: 'desc' }), '?sort=id');
  });

  it('preserves other filters but drops page (a new order invalidates the offset)', () => {
    const href = sortHref({ search: 'abc', page: '4', perPage: '50' }, 'id', {
      key: '',
      dir: 'asc',
    });
    const qs = new URLSearchParams(href.slice(1));
    assert.equal(qs.get('search'), 'abc');
    assert.equal(qs.get('perPage'), '50');
    assert.equal(qs.get('page'), null);
    assert.equal(qs.get('sort'), 'id');
  });

  it('drops empty params rather than emitting bare keys', () => {
    assert.equal(sortHref({ search: '' }, 'id', { key: '', dir: 'asc' }), '?sort=id');
  });
});
