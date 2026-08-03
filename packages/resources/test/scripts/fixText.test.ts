/**
 * Self-check for the mechanical text normalizer.
 *
 * The two properties that matter are invariants, not individual rewrites: the
 * tables must keep their row count (dialog rows are referenced by index from
 * `NpcScript.cpp`) and every markup token must survive verbatim. The rest are
 * unit cases for each rule, including the ones that must NOT fire.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { fixRow } from '../../scripts/fixText';

describe('fixRow — whitespace', () => {
  it('collapses runs of spaces to one', () => {
    assert.equal(fixRow('Done.  Next.'), 'Done. Next.');
  });

  it('trims leading and trailing space', () => {
    assert.equal(fixRow('  hi.  '), 'hi.');
  });

  it('strips space around the literal \\n escape', () => {
    assert.equal(fixRow('one.\\n 2. two'), 'one.\\n2. two');
    assert.equal(fixRow('one. \\n2. two'), 'one.\\n2. two');
  });
});

describe('fixRow — punctuation', () => {
  it('collapses period runs to a single ellipsis', () => {
    assert.equal(fixRow('........'), '...');
    assert.equal(fixRow('back.. ..'), 'back...');
    assert.equal(fixRow('spicy..'), 'spicy...');
  });

  it('leaves a real ellipsis alone', () => {
    assert.equal(fixRow('wait... ok'), 'wait... ok');
  });

  it('keeps intentional emphasis runs', () => {
    assert.equal(fixRow('Really?!'), 'Really?!');
    assert.equal(fixRow('Stop!!'), 'Stop!!');
    assert.equal(fixRow('Hello???'), 'Hello???');
  });

  it('collapses a doubled comma or semicolon', () => {
    assert.equal(fixRow('a,,b'), 'a, b');
  });

  it('removes space before punctuation', () => {
    assert.equal(fixRow('Poul , who'), 'Poul, who');
    assert.equal(fixRow('Thank you .'), 'Thank you.');
  });

  it('adds the missing space after a comma', () => {
    assert.equal(fixRow('one,two'), 'one, two');
  });

  it('does not split a thousands separator or a clock time', () => {
    assert.equal(fixRow('1,000 penya at 12:30'), '1,000 penya at 12:30');
  });
});

describe('fixRow — pronoun', () => {
  it('capitalizes the standalone pronoun', () => {
    assert.equal(fixRow('maybe i can'), 'maybe I can');
    assert.equal(fixRow('who am i Listen'), 'who am I Listen');
  });

  it('leaves i inside a word or contraction', () => {
    assert.equal(fixRow('is it in his list'), 'is it in his list');
    assert.equal(fixRow("i'm here"), "i'm here");
  });
});

describe('fixRow — CP949 leftovers', () => {
  it('converts the Korean codepage curly quotes to ASCII', () => {
    assert.equal(fixRow('say ¡°Redeem Gift¡±.'), 'say "Redeem Gift".');
  });

  it('drops the decorative eighth note and its orphaned space', () => {
    assert.equal(fixRow('cupid god¢Ü'), 'cupid god');
  });
});

describe('fixRow — markup and non-English rows are untouched', () => {
  it('preserves #codes, <tags>, and [menu][] markup verbatim', () => {
    const row = '#b#nc<Billion> [your job][]?';
    assert.equal(fixRow(row), row);
  });

  it('returns Korean rows unchanged', () => {
    const ko = '견우의  사랑..';
    assert.equal(fixRow(ko), ko);
  });

  it('is idempotent', () => {
    const once = fixRow('Done.  Next.. ..  i think');
    assert.equal(fixRow(once), once);
  });
});
