/**
 * Tests for packages/core/src/constants/sessionState.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SessionState } from '../../src/constants/sessionState.js';
import type { SessionStateValue } from '../../src/constants/sessionState.js';

describe('SessionState constants', () => {
  it('CONNECTED equals 0', () => {
    assert.equal(SessionState.CONNECTED, 0);
  });

  it('AUTHENTICATED equals 1', () => {
    assert.equal(SessionState.AUTHENTICATED, 1);
  });

  it('IN_CLUSTER equals 2', () => {
    assert.equal(SessionState.IN_CLUSTER, 2);
  });

  it('IN_WORLD equals 3', () => {
    assert.equal(SessionState.IN_WORLD, 3);
  });

  it('all values are numbers', () => {
    for (const key of Object.keys(SessionState)) {
      const val = SessionState[key as keyof typeof SessionState];
      assert.equal(typeof val, 'number', `Expected ${key} to be a number`);
    }
  });

  it('states are in ascending order (CONNECTED < IN_WORLD)', () => {
    assert.ok(SessionState.CONNECTED < SessionState.AUTHENTICATED);
    assert.ok(SessionState.AUTHENTICATED < SessionState.IN_CLUSTER);
    assert.ok(SessionState.IN_CLUSTER < SessionState.IN_WORLD);
  });

  it('Object.freeze prevents mutation in strict mode', () => {
    assert.throws(() => {
      'use strict';
      // @ts-expect-error -- intentionally testing runtime freeze behaviour
      SessionState['IN_WORLD'] = 99;
    });
  });

  it('SessionStateValue type encompasses IN_WORLD', () => {
    const s: SessionStateValue = SessionState.IN_WORLD;
    assert.equal(s, 3);
  });
});
