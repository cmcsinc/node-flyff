import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { compose } from '../src/compose.js';

describe('compose', () => {
  it('exports compose function', () => {
    assert.equal(typeof compose, 'function');
  });
});
