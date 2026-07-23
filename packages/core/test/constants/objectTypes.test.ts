/**
 * Tests for packages/core/src/constants/objectTypes.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ObjectType } from '../../src/constants/objectTypes';
import type { ObjectTypeValue } from '../../src/constants/objectTypes';

describe('ObjectType constants', () => {
  it('matches the C++ OT_* enum (sequential from 0)', () => {
    assert.equal(ObjectType.OBJ, 0);
    assert.equal(ObjectType.ANI, 1);
    assert.equal(ObjectType.CTRL, 2);
    assert.equal(ObjectType.SFX, 3);
    assert.equal(ObjectType.ITEM, 4);
    assert.equal(ObjectType.MOVER, 5);
    assert.equal(ObjectType.REGION, 6);
    assert.equal(ObjectType.SHIP, 7);
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
      // @ts-expect-error -- intentionally testing runtime freeze behaviour
      ObjectType['MOVER'] = 99;
    });
  });

  it('ObjectTypeValue type encompasses MOVER', () => {
    const t: ObjectTypeValue = ObjectType.MOVER;
    assert.equal(t, 5);
  });
});
