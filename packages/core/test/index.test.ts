import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import * as core from '../src/index';

describe('core index', () => {
  it('exports core module namespace', () => {
    assert.ok(core);
  });
});
