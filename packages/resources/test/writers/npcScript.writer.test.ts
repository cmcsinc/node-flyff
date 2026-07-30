/**
 * Tests for the surgical `NpcScript.cpp` writer.
 *
 * The file under edit is a 433 KB compile input for the client-side dialog DLL,
 * shared byte-for-byte with `game/source/WORLDDIALOG/NpcScript.cpp`. So the
 * invariants asserted here are "nothing outside the edited body moved" and "the
 * converter reads back what it wrote", not "the output looks plausible".
 *
 * The round-trip test reimplements the converter's own `parseState`
 * (`scripts/converters/dialogs.ts:69`) because it is not exported. Any drift
 * between the copy below and the converter would show up as a failing
 * round-trip, which is the point.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyNpcScriptEdit, writeNpcScriptEdit } from '../../src/writers/npcScript.writer';
import type { DialogState } from '../../src/schemas/dialog.schema';
import { parseState } from '../../scripts/converters/dialogs';

const RAW_DIR = resolve(fileURLToPath(new URL('../../raw', import.meta.url)));
const REAL_CPP = resolve(RAW_DIR, 'NpcScript.cpp');

// ── Converter parity ─────────────────────────────────────────────────────────
//
// `parseState` is imported from the converter itself, not copied. A copy would
// let the converter drift while this test still passed, which is exactly the
// drift the round-trip is meant to catch.

/** Narrow the converter's loose return to the schema type. */
function reduce(body: string): DialogState {
  return parseState(body) as DialogState;
}

/** Extract a function's raw body the way the converter does (brace-delimited). */
function extractBody(text: string, prefix: string, keyIdx: string): string {
  const re = new RegExp(`void\\s+CNpcScript::${prefix}_${keyIdx}(?![0-9])\\s*\\(\\s*\\)`);
  const m = re.exec(text);
  assert.ok(m, `function ${prefix}_${keyIdx} not found`);
  let i = m.index + m[0].length;
  while (text[i] !== '{') i++;
  const start = i + 1;
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) break;
  }
  return text.slice(start, i);
}

// ── Fixture: a trimmed but structurally faithful slice ────────────────────────

const FIX = [
  '//Script Begin',
  'void CNpcScript::mafl_andy_0()',
  '{',
  '\tSpeak( NpcId(), 393 );\t',
  '\tSetScriptTimer( 15 );',
  '}',
  '',
  'void CNpcScript::mafl_andy_2()',
  '{',
  '\tAddKey( 9 );',
  '\tAddKey( 10 );\t\t',
  '}',
  '',
  'void CNpcScript::mafl_andy_10()',
  '{',
  '\tSpeak( NpcId(), 396 );',
  '\tExit();',
  '}',
  '',
  '//Script End',
  '',
  '//Script Information---------------------------------//',
  '// File\t\t\t: MaFl_Other.txt',
  '//---------------------------------------------------//',
  '',
  '//Script Begin',
  'void CNpcScript::mafl_other_0()',
  '{',
  '\tSay( 1 );',
  '}',
  '',
].join('\r\n');

// ── Pure apply ───────────────────────────────────────────────────────────────

void describe('applyNpcScriptEdit', () => {
  void it('replaces only the target body, byte-identical elsewhere', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', { states: { '2': { say: [77] } } });

    assert.equal(extractBody(out, 'mafl_andy', '2'), '\r\n\tSay( 77 );\r\n');
    // Everything before and after the edited body is untouched.
    const before = FIX.indexOf('void CNpcScript::mafl_andy_2()');
    assert.equal(out.slice(0, before), FIX.slice(0, before));
    const tail = '//Script End\r\n\r\n//Script Information';
    assert.equal(out.slice(out.indexOf(tail)), FIX.slice(FIX.indexOf(tail)));
    // The other NPC's group and its header comment survive verbatim.
    assert.ok(out.includes('// File\t\t\t: MaFl_Other.txt'));
    assert.equal(extractBody(out, 'mafl_other', '0'), '\r\n\tSay( 1 );\r\n');
  });

  void it('does not confuse state 1 with state 10', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', { states: { '10': { exit: true } } });
    assert.equal(extractBody(out, 'mafl_andy', '10'), '\r\n\tExit();\r\n');
    // _0 must be untouched; a greedy match would have eaten it.
    assert.match(extractBody(out, 'mafl_andy', '0'), /Speak\( NpcId\(\), 393 \)/);
  });

  void it('never introduces a bare LF', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', {
      states: { '0': { speak: [1], say: [2], keys: [{ label: 3, key: 4 }], timer: 5, exit: true } },
    });
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  });

  void it('emits statements in the fixed order regardless of field order', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', {
      states: {
        '2': {
          exit: true,
          timer: 15,
          launch_quest: true,
          keys: [{ label: 9 }, { label: 10, key: 11 }, { label: 12, key: 13, param: 14 }],
          say: [20],
          speak: [30],
        },
      },
    });
    assert.equal(
      extractBody(out, 'mafl_andy', '2'),
      [
        '',
        '\tSpeak( NpcId(), 30 );',
        '\tSay( 20 );',
        '\tAddKey( 9 );',
        '\tAddKey( 10, 11 );',
        '\tAddKey( 12, 13, 14 );',
        '\tLaunchQuest();',
        '\tSetScriptTimer( 15 );',
        '\tExit();',
        '',
      ].join('\r\n'),
    );
  });

  void it('emits an empty body for an empty state', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', { states: { '2': {} } });
    assert.equal(extractBody(out, 'mafl_andy', '2'), '\r\n');
  });

  void it('emits source verbatim and ignores structured fields', () => {
    const source = 'if(GetItemNum(II_X) == 0)\r\n\t{\r\n\t\tAddCondKey( 45,11 );\r\n\t}';
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', {
      states: { '2': { source, say: [999] } },
    });
    const body = extractBody(out, 'mafl_andy', '2');
    assert.equal(body.includes('999'), false);
    assert.equal(body.trim(), source);
  });

  void it('rejects AddKey param without key (positional args)', () => {
    assert.throws(
      () => applyNpcScriptEdit(FIX, 'mafl_andy', { states: { '2': { keys: [{ label: 1, param: 3 }] } } }),
      /param cannot be written without key/,
    );
  });

  void it('batch-edits many states without offset drift', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', {
      states: { '0': { say: [1] }, '2': { say: [2] }, '10': { say: [3] } },
    });
    assert.equal(extractBody(out, 'mafl_andy', '0'), '\r\n\tSay( 1 );\r\n');
    assert.equal(extractBody(out, 'mafl_andy', '2'), '\r\n\tSay( 2 );\r\n');
    assert.equal(extractBody(out, 'mafl_andy', '10'), '\r\n\tSay( 3 );\r\n');
  });
});

// ── Insert / failure modes ───────────────────────────────────────────────────

void describe('applyNpcScriptEdit -- new states', () => {
  void it('inserts a new state after the prefix highest-numbered function', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', { states: { '11': { say: [5] } } });
    assert.equal(extractBody(out, 'mafl_andy', '11'), '\r\n\tSay( 5 );\r\n');
    // Contiguity: the new function precedes the group's //Script End fence.
    assert.ok(out.indexOf('mafl_andy_11') < out.indexOf('//Script End'));
    // And it did not land in the neighbouring group.
    assert.ok(out.indexOf('mafl_andy_11') < out.indexOf('mafl_other_0'));
  });

  void it('inserts after _10, not after _2 (numeric, not lexical, max)', () => {
    const out = applyNpcScriptEdit(FIX, 'mafl_andy', { states: { '12': {} } });
    assert.ok(out.indexOf('mafl_andy_12') > out.indexOf('mafl_andy_10'));
  });

  void it('throws for a prefix with no existing functions', () => {
    assert.throws(
      () => applyNpcScriptEdit(FIX, 'nope_nobody', { states: { '0': {} } }),
      /refusing to create a new script group/,
    );
  });
});

// ── Round-trip invariant against the real 28k-line file ──────────────────────

void describe('applyNpcScriptEdit -- round-trip on the real NpcScript.cpp', () => {
  const load = async (): Promise<string> => {
    const buf = await readFile(REAL_CPP);
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    return (bom ? buf.subarray(3) : buf).toString('utf8');
  };

  for (const prefix of ['mafl_andy', 'dudk_drian', 'mafl_marche']) {
    void it(`parse -> emit -> parse is identical for ${prefix}`, async () => {
      const text = await load();
      const re = new RegExp(`void\\s+CNpcScript::${prefix}_(\\d+)\\s*\\(\\s*\\)`, 'g');
      const keys = [...text.matchAll(re)].map((m) => m[1] ?? '');
      assert.ok(keys.length > 0, `${prefix} has no functions in the real file`);

      const states: Record<string, DialogState> = {};
      for (const k of keys) states[k] = reduce(extractBody(text, prefix, k));

      const out = applyNpcScriptEdit(text, prefix, { states });
      for (const k of keys) {
        assert.deepEqual(reduce(extractBody(out, prefix, k)), states[k], `state ${k}`);
      }
    });
  }

  void it('dudk_drian source states survive verbatim', async () => {
    const text = await load();
    const sourceKeys = ['1', '2', '4', '6', '11'];
    const states: Record<string, DialogState> = {};
    for (const k of sourceKeys) {
      const s = reduce(extractBody(text, 'dudk_drian', k));
      assert.ok(s.source !== undefined, `dudk_drian_${k} expected to carry source`);
      states[k] = s;
    }
    const out = applyNpcScriptEdit(text, 'dudk_drian', { states });
    for (const k of sourceKeys) {
      assert.equal(extractBody(out, 'dudk_drian', k).trim(), states[k]?.source);
    }
  });

  void it('a one-function edit changes only that line range', async () => {
    const text = await load();
    const before = extractBody(text, 'mafl_andy', '3');
    const out = applyNpcScriptEdit(text, 'mafl_andy', { states: { '3': { say: [42] } } });

    const head = text.indexOf('void CNpcScript::mafl_andy_3()');
    assert.equal(out.slice(0, head), text.slice(0, head));
    const tailMark = 'void CNpcScript::mafl_andy_4()';
    assert.equal(out.slice(out.indexOf(tailMark)), text.slice(text.indexOf(tailMark)));
    assert.notEqual(extractBody(out, 'mafl_andy', '3'), before);
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  });

  void it('Korean comments and the CRLF-only convention round-trip', async () => {
    const text = await load();
    const out = applyNpcScriptEdit(text, 'mafl_andy', { states: { '3': { say: [42] } } });
    assert.ok(out.includes('조건 성공'));
    assert.equal(out.split('\r\n').length, text.split('\r\n').length);
  });
});

// ── I/O wrapper ──────────────────────────────────────────────────────────────

void describe('writeNpcScriptEdit', () => {
  void it('preserves the UTF-8 BOM and never touches raw/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'npcscript-'));
    try {
      const orig = await readFile(REAL_CPP);
      await writeFile(join(dir, 'NpcScript.cpp'), orig);

      await writeNpcScriptEdit(dir, 'mafl_andy', { states: { '3': { say: [4242] } } });

      const out = await readFile(join(dir, 'NpcScript.cpp'));
      assert.deepEqual([...out.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      const decoded = out.subarray(3).toString('utf8');
      assert.match(decoded, /void CNpcScript::mafl_andy_3\(\)\r\n\{\r\n\tSay\( 4242 \);\r\n\}/);
      assert.equal(decoded.replace(/\r\n/g, '').includes('\n'), false);
      // The real file is untouched by the temp-dir write.
      assert.deepEqual(await readFile(REAL_CPP), orig);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
