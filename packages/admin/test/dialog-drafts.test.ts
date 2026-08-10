/**
 * Dialog draft → PUT body serialization.
 *
 * The point of these: the panel edits text while the file stores indices, so
 * this module owns the mapping. Two failure modes it must not have — appending a
 * row for text that already has one (which would orphan the old row and leave
 * the state pointing at unchanged text), and emitting a `source` state (which
 * the writer would rewrite verbatim, ignoring the edit).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendCount,
  blankLine,
  buildPutBody,
  isDirty,
  type LineDraft,
  type StateDraft,
} from '../components/dialog/dialog-drafts';

function state(over: Partial<StateDraft> = {}): StateDraft {
  return {
    keyIdx: 9,
    say: [],
    speak: [],
    keys: [],
    exit: false,
    timer: null,
    launchQuest: false,
    hasSource: false,
    ...over,
  };
}

function line(index: number | null, text: string, original = text, uses = 1): LineDraft {
  return { index, text, original, uses };
}

describe('buildPutBody', () => {
  it('emits nothing when nothing changed', () => {
    const base = [state({ say: [line(107, 'Hello')] })];
    const body = buildPutBody('mafl_andy', base, base);
    assert.equal(body.states, undefined);
    assert.equal(body.texts, undefined);
    assert.equal(body.newTexts, undefined);
    assert.equal(isDirty(base, base), false);
  });

  it('edits an existing row in place, without appending', () => {
    const base = [state({ say: [line(107, 'Hello')] })];
    const next = [state({ say: [line(107, 'Goodbye', 'Hello')] })];
    const body = buildPutBody('mafl_andy', next, base);
    assert.deepEqual(body.texts, [{ index: 107, text: 'Goodbye' }]);
    assert.equal(body.newTexts, undefined);
    // Text-only edit: the state's structure is unchanged, so no state is written.
    assert.equal(body.states, undefined);
    assert.equal(isDirty(next, base), true);
  });

  it('appends a new line and references it by placeholder', () => {
    const base = [state({ say: [line(107, 'Hello')] })];
    const next = [state({ say: [line(107, 'Hello'), { ...blankLine(), text: 'More' }] })];
    const body = buildPutBody('mafl_andy', next, base);
    assert.deepEqual(body.newTexts, ['More']);
    // -1 is the placeholder for newTexts[0]; the route swaps in the real index.
    assert.deepEqual(body.states?.['9']?.say, [107, -1]);
    assert.equal(appendCount(next), 1);
  });

  it('numbers multiple placeholders in submission order', () => {
    const base = [state({ say: [] })];
    const next = [
      state({
        say: [{ ...blankLine(), text: 'A' }],
        speak: [{ ...blankLine(), text: 'B' }],
      }),
    ];
    const body = buildPutBody('mafl_andy', next, base);
    assert.deepEqual(body.newTexts, ['A', 'B']);
    const nine = body.states?.['9'];
    assert.ok(nine);
    assert.deepEqual(nine.say, [-1]);
    assert.deepEqual(nine.speak, [-2]);
  });

  it('never emits a source state — the writer would ignore the edit', () => {
    const base = [state({ hasSource: true, say: [line(393, 'Hi')] })];
    const next = [state({ hasSource: true, say: [line(393, 'Changed', 'Hi')] })];
    const body = buildPutBody('mafl_andy', next, base);
    assert.equal(body.states, undefined);
    assert.equal(body.texts, undefined);
  });

  it('carries choice routing only when set', () => {
    const base = [state({ keys: [] })];
    const next = [state({ keys: [{ label: line(9, 'Introduce'), key: 3, param: null }] })];
    const body = buildPutBody('mafl_andy', next, base);
    assert.deepEqual(body.states?.['9']?.keys, [{ label: 9, key: 3 }]);
  });

  it('treats a removed line as a structural change', () => {
    const base = [state({ say: [line(107, 'Hello'), line(108, 'Bye')] })];
    const next = [state({ say: [line(107, 'Hello')] })];
    const body = buildPutBody('mafl_andy', next, base);
    assert.deepEqual(body.states?.['9']?.say, [107]);
  });

  it("keeps a text edit on an untouched state's line", () => {
    // State 9 is structurally unchanged but its row text moved; the row still
    // has to reach WorldDialog.txt.
    const base = [state({ keyIdx: 9, say: [line(107, 'Hello')] }), state({ keyIdx: 10 })];
    const next = [
      state({ keyIdx: 9, say: [line(107, 'Hi', 'Hello')] }),
      state({ keyIdx: 10, exit: true }),
    ];
    const body = buildPutBody('mafl_andy', next, base);
    assert.deepEqual(body.texts, [{ index: 107, text: 'Hi' }]);
    assert.deepEqual(body.states?.['10'], { exit: true });
  });
});
