/**
 * `stripBlockComments` + `parseDefines` -- a commented-out `#define` block is
 * dead code the C preprocessor never sees, so first-write-wins must not prefer
 * it. Regression guard for the `defineObj.h` dead `MI_*` block (lines 1852-1921)
 * that made 65 of 1120 mover ids resolve to the wrong `dwObjIndex`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDefines, stripBlockComments } from '../../scripts/converters/parse';

describe('stripBlockComments', () => {
  it('blanks block bodies but preserves line count', () => {
    const src = 'a\n/* x\ny\nz */\nb';
    const out = stripBlockComments(src);
    assert.equal(out.split('\n').length, src.split('\n').length);
    assert.equal(out.split('\n')[4], 'b');
    assert.ok(!out.includes('x'));
  });

  it('leaves line comments and code alone', () => {
    assert.equal(stripBlockComments('// keep /*me*/\n'), '// keep \n');
  });
});

describe('parseDefines with a dead commented block', () => {
  // Shape of defineObj.h: dead renumbered block, then the live one.
  const header = [
    '/*',
    '#define MI_FOO1   32',
    '#define MI_BAR2   60',
    '*/',
    '#define MI_FOO1   36',
    '#define MI_BAR2   73',
    '',
  ].join('\n');

  it('resolves symbols to the LIVE block, not the commented one', () => {
    const m = parseDefines(header, 'MI_');
    assert.equal(m.get('MI_FOO1'), 36);
    assert.equal(m.get('MI_BAR2'), 73);
  });

  it('still keeps first-write-wins across two LIVE blocks', () => {
    const twoLive = '#define MI_FOO1   36\n#define MI_FOO1   99\n';
    assert.equal(parseDefines(twoLive, 'MI_').get('MI_FOO1'), 36);
  });
});
