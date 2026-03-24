/**
 * Tests for packages/core/src/constants/objectTypes.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ObjectType } from './objectTypes.js';
import type { ObjectTypeValue } from './objectTypes.js';

describe('ObjectType constants', () => {
  it('MOVER equals 0', () => {
    assert.equal(ObjectType.MOVER, 0);
  });

  it('ITEM equals 1', () => {
    assert.equal(ObjectType.ITEM, 1);
  });

  it('CTRL equals 2', () => {
    assert.equal(ObjectType.CTRL, 2);
  });

  it('REGION equals 3', () => {
    assert.equal(ObjectType.REGION, 3);
  });

  it('PATH equals 4', () => {
    assert.equal(ObjectType.PATH, 4);
  });

  it('SHIP equals 5', () => {
    assert.equal(ObjectType.SHIP, 5);
  });

  it('all values are numbers', () => {
    for (const key of Object.keys(ObjectType)) {
      const val = ObjectType[key as keyof typeof ObjectType];
      assert.equal(typeof val, 'number', `Expected ${key} to be a number`);
    }
  });

  it('Object.freeze prevents mutation in strict mode', () => {
    assert.throws(() => {
      'use strict';
      // @ts-expect-error — intentionally testing runtime freeze behaviour
      ObjectType['MOVER'] = 99;
    });
  });

  it('ObjectTypeValue type encompasses MOVER', () => {
    const t: ObjectTypeValue = ObjectType.MOVER;
    assert.equal(t, 0);
  });
});
