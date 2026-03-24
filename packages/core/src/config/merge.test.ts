/**
 * Tests for the deepMerge utility.
 *
 * @module config/merge.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { deepMerge } from './merge.js';

describe('deepMerge', () => {
  // -------------------------------------------------------------------------
  // No arguments
  // -------------------------------------------------------------------------

  it('returns empty object when called with no arguments', () => {
    const result = deepMerge();
    assert.deepEqual(result, {});
  });

  // -------------------------------------------------------------------------
  // Flat objects
  // -------------------------------------------------------------------------

  it('merges two flat objects', () => {
    const a = { x: 1, y: 2 };
    const b = { z: 3 };
    const result = deepMerge(a, b);
    assert.deepEqual(result, { x: 1, y: 2, z: 3 });
  });

  it('later argument overrides earlier for same scalar key', () => {
    const a = { port: 3000, host: 'localhost' };
    const b = { port: 8080 };
    const result = deepMerge(a, b);
    assert.deepEqual(result, { port: 8080, host: 'localhost' });
  });

  // -------------------------------------------------------------------------
  // Nested / deep objects
  // -------------------------------------------------------------------------

  it('deep merges nested objects without overwriting sibling keys', () => {
    const a = { server: { host: '0.0.0.0', port: 23000 } };
    const b = { server: { port: 9999 } };
    const result = deepMerge(a, b);
    // host must survive — it was not overridden
    assert.deepEqual(result, { server: { host: '0.0.0.0', port: 9999 } });
  });

  it('deep merges multiple nesting levels', () => {
    const a = { a: { b: { c: 1, d: 2 } } };
    const b = { a: { b: { d: 99, e: 5 } } };
    const result = deepMerge(a, b);
    assert.deepEqual(result, { a: { b: { c: 1, d: 99, e: 5 } } });
  });

  // -------------------------------------------------------------------------
  // Arrays are replaced, not concatenated
  // -------------------------------------------------------------------------

  it('replaces arrays rather than concatenating them', () => {
    const a = { serverList: ['alpha', 'beta'] };
    const b = { serverList: ['gamma'] };
    const result = deepMerge(a, b);
    // The array from `b` must wholly replace the one from `a`
    assert.deepEqual(result, { serverList: ['gamma'] });
    assert.equal((result['serverList'] as string[]).length, 1);
  });

  it('replaces an array with an empty array when source provides []', () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [] };
    const result = deepMerge(a, b);
    assert.deepEqual(result, { items: [] });
  });

  // -------------------------------------------------------------------------
  // null / undefined source values do NOT overwrite non-null target values
  // -------------------------------------------------------------------------

  it('undefined source value does not overwrite existing target value', () => {
    const a = { name: 'flyff' };
    const b = { name: undefined };
    const result = deepMerge(a, b);
    // undefined should not clobber the existing value
    assert.equal(result['name'], 'flyff');
  });

  it('null source value overwrites target (null is an explicit value)', () => {
    const a = { name: 'flyff' };
    const b = { name: null };
    const result = deepMerge(a, b);
    // null is not undefined — it IS a value and should win
    assert.equal(result['name'], null);
  });

  // -------------------------------------------------------------------------
  // Multiple layers (3+ arguments)
  // -------------------------------------------------------------------------

  it('merges three layers with correct priority (last wins)', () => {
    const defaults = { host: '0.0.0.0', port: 3000, debug: false };
    const fileConfig = { port: 8080 };
    const envOverrides = { port: 9000, debug: true };
    const result = deepMerge(defaults, fileConfig, envOverrides);
    assert.deepEqual(result, { host: '0.0.0.0', port: 9000, debug: true });
  });

  it('handles four layers where each successive layer narrows one field', () => {
    const l1 = { a: 1, b: 2, c: 3, d: 4 };
    const l2 = { a: 10 };
    const l3 = { b: 20 };
    const l4 = { c: 30 };
    const result = deepMerge(l1, l2, l3, l4);
    assert.deepEqual(result, { a: 10, b: 20, c: 30, d: 4 });
  });

  it('deep merges three layers of nested objects', () => {
    const l1 = { server: { host: '0.0.0.0', port: 1000, tls: false } };
    const l2 = { server: { port: 2000 } };
    const l3 = { server: { tls: true } };
    const result = deepMerge(l1, l2, l3);
    assert.deepEqual(result, { server: { host: '0.0.0.0', port: 2000, tls: true } });
  });

  // -------------------------------------------------------------------------
  // Does not mutate the original inputs
  // -------------------------------------------------------------------------

  it('does not mutate either source object', () => {
    const a = { x: 1 };
    const b = { x: 2, y: 3 };
    deepMerge(a, b);
    assert.equal(a['x'], 1);
    assert.equal((b as Record<string, unknown>)['y'], 3);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('handles a single source argument (identity)', () => {
    const a = { key: 'value', nested: { n: 42 } };
    const result = deepMerge(a);
    assert.deepEqual(result, a);
    // Ensure it is a new object (shallow copy at top level)
    assert.notEqual(result, a);
  });

  it('treats class instances in source as plain scalars (replaces, not merges)', () => {
    // Date objects have prototype !== Object.prototype — they should be replaced
    const d = new Date('2026-01-01');
    const a = { ts: { year: 2025 } };
    const b = { ts: d };
    const result = deepMerge(a, b);
    assert.equal(result['ts'], d);
  });
});
