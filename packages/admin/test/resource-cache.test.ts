import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { getYamlDir, invalidateResourceCache } from '../lib/resource-cache';

describe('resource-cache getYamlDir', () => {
  beforeEach(() => {
    invalidateResourceCache();
  });

  it('returns the same array instance on repeat calls (parsed once)', () => {
    const a = getYamlDir('items');
    const b = getYamlDir('items');
    assert.ok(a.length > 0, 'expected item YAML files to be found');
    assert.equal(a, b, 'second call must hit the cache, not re-read the dir');
    assert.ok(a[0].file.endsWith('.yml'));
    assert.equal(typeof a[0].doc, 'object');
  });

  it('re-reads after invalidation', () => {
    const a = getYamlDir('items');
    invalidateResourceCache();
    const c = getYamlDir('items');
    assert.notEqual(a, c, 'invalidation must force a fresh read');
    assert.equal(a.length, c.length);
  });

  it('returns empty for a missing directory', () => {
    assert.deepEqual(getYamlDir('does-not-exist'), []);
  });
});
