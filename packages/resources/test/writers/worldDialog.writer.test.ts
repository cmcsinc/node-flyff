/**
 * Tests for the `WorldDialog.txt` string-table writer.
 *
 * The invariant under test is positional, not textual: every row's index is
 * referenced by number from `NpcScript.cpp`, so a writer that shifts rows
 * silently repoints 4,244 dialog functions at the wrong text. Insert and delete
 * are therefore absent from the API, and these tests pin that down along with
 * the latin1 codec (the real file is not valid UTF-8).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  applyDialogStringEdits,
  appendDialogStrings,
  dialogStringCount,
  writeDialogStrings,
} from '../../src/writers/worldDialog.writer';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** CRLF, trailing newline, and a latin1 byte — the real file's three hazards. */
const TXT = [
  '#auto',
  '#init',
  '#addKey',
  'Introduce',
  'Farewell',
  'I am the rumored cupid god¢Ü',
  '',
].join('\r\n');

void describe('applyDialogStringEdits', () => {
  void   it('replaces one row and leaves every other byte alone', () => {
    const out = applyDialogStringEdits(TXT, [{ index: 3, text: 'Greetings' }]);
    const rows = out.split('\r\n');
    assert.equal(rows[3], 'Greetings');
    assert.equal(rows[0], '#auto');
    assert.equal(rows[4], 'Farewell');
    assert.equal(rows[5], 'I am the rumored cupid god¢Ü');
  });

  void   it('keeps CRLF and the trailing newline', () => {
    const out = applyDialogStringEdits(TXT, [{ index: 0, text: '#AUTO' }]);
    assert.equal(out.includes('\n') && !/(?<!\r)\n/.test(out), true, 'introduced a bare LF');
    assert.ok(out.endsWith('\r\n'), 'lost the trailing newline');
  });

  void   it('applies several edits in one pass', () => {
    const out = applyDialogStringEdits(TXT, [
      { index: 3, text: 'A' },
      { index: 4, text: 'B' },
    ]);
    const rows = out.split('\r\n');
    assert.equal(rows[3], 'A');
    assert.equal(rows[4], 'B');
  });

  void   it('is a no-op for an empty edit list', () => {
    assert.equal(applyDialogStringEdits(TXT, []), TXT);
  });

  void   it('refuses an index past the end — appending must be explicit', () => {
    assert.throws(
      () => applyDialogStringEdits(TXT, [{ index: 99, text: 'x' }]),
      /row 99 does not exist/,
    );
  });

  void   it('refuses a negative or fractional index', () => {
    assert.throws(() => applyDialogStringEdits(TXT, [{ index: -1, text: 'x' }]), /does not exist/);
    assert.throws(() => applyDialogStringEdits(TXT, [{ index: 1.5, text: 'x' }]), /does not exist/);
  });

  void   it('refuses text outside latin1 rather than writing a different byte', () => {
    assert.throws(
      () => applyDialogStringEdits(TXT, [{ index: 3, text: '안녕' }]),
      /outside latin1/,
    );
  });
});

void describe('appendDialogStrings', () => {
  void   it('appends past the end and reports the assigned indices', () => {
    const { text, indices } = appendDialogStrings(TXT, ['New one', 'New two']);
    assert.deepEqual(indices, [6, 7]);
    const rows = text.split('\r\n');
    assert.equal(rows[6], 'New one');
    assert.equal(rows[7], 'New two');
    // Nothing before the append moved.
    assert.equal(rows[3], 'Introduce');
    assert.ok(text.endsWith('\r\n'));
  });

  void   it('never renumbers an existing row', () => {
    const before = TXT.split('\r\n').slice(0, 6);
    const { text } = appendDialogStrings(TXT, ['x']);
    assert.deepEqual(text.split('\r\n').slice(0, 6), before);
  });

  void   it('reports the next free index', () => {
    assert.equal(dialogStringCount(TXT), 6);
    const { text } = appendDialogStrings(TXT, ['x']);
    assert.equal(dialogStringCount(text), 7);
  });
});

// ── I/O round trip ────────────────────────────────────────────────────────────

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'worlddialog-'));
  await writeFile(join(dir, 'WorldDialog.txt'), Buffer.from(TXT, 'latin1'));
  await mkdir(join(dir, 'data', 'dialogues'), { recursive: true });
  await writeFile(
    join(dir, 'data', 'dialogues', '_strings.yml'),
    `_version: "1.0"\nstrings:\n${TXT.split('\r\n').slice(0, 6).map((s) => `  - ${JSON.stringify(s)}`).join('\n')}\n`,
    'utf-8',
  );
  return dir;
}

void describe('writeDialogStrings', () => {
  void   it('writes both halves so the yml can never drift from the txt', async () => {
    const dir = await scratch();
    try {
      await writeDialogStrings(dir, join(dir, 'data'), {
        edits: [{ index: 3, text: 'Greetings' }],
      });
      const txt = (await readFile(join(dir, 'WorldDialog.txt'))).toString('latin1');
      const yml = parse(await readFile(join(dir, 'data', 'dialogues', '_strings.yml'), 'utf-8')) as {
        strings: string[];
      };
      assert.equal(txt.split('\r\n')[3], 'Greetings');
      assert.equal(yml.strings[3], 'Greetings');
      assert.equal(yml.strings.length, 6, 'yml row count drifted from the txt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  void   it('returns the indices an append was given, for the caller to reference', async () => {
    const dir = await scratch();
    try {
      const indices = await writeDialogStrings(dir, join(dir, 'data'), {
        append: ['Fresh line'],
      });
      assert.deepEqual(indices, [6]);
      const yml = parse(await readFile(join(dir, 'data', 'dialogues', '_strings.yml'), 'utf-8')) as {
        strings: string[];
      };
      assert.equal(yml.strings[6], 'Fresh line');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  void   it('preserves the latin1 byte on an untouched row', async () => {
    const dir = await scratch();
    try {
      await writeDialogStrings(dir, join(dir, 'data'), { edits: [{ index: 0, text: '#AUTO' }] });
      const buf = await readFile(join(dir, 'WorldDialog.txt'));
      assert.ok(buf.includes(Buffer.from([0xa2, 0xdc])), 'latin1 bytes were re-encoded');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── The real file ─────────────────────────────────────────────────────────────
//
// Fixtures only cover the hazards I thought to write down. This runs against the
// real 136,930-byte raw/WorldDialog.txt so an unanticipated shape still fails.
// Read-only: edits are applied to an in-memory copy, never written back.

const RAW_DIR = fileURLToPath(new URL('../../raw/', import.meta.url));

void describe('worldDialog writer — real raw/WorldDialog.txt', () => {
  void   it('round-trips the real file byte-identically through decode/encode', async () => {
    let buf: Buffer;
    try {
      buf = await readFile(join(RAW_DIR, 'WorldDialog.txt'));
    } catch {
      return; // raw/ absent in this checkout
    }
    const text = buf.toString('latin1');
    assert.ok(Buffer.from(text, 'latin1').equals(buf), 'latin1 round-trip is not byte-identical');
    // A no-op edit list must not perturb a single byte.
    assert.equal(applyDialogStringEdits(text, []), text);
  });

  void   it('keeps every other row identical when one real row is replaced', async () => {
    let buf: Buffer;
    try {
      buf = await readFile(join(RAW_DIR, 'WorldDialog.txt'));
    } catch {
      return;
    }
    const text = buf.toString('latin1');
    const count = dialogStringCount(text);
    assert.ok(count > 1800, `expected the full table, found ${String(count)} rows`);

    const out = applyDialogStringEdits(text, [{ index: 44, text: 'Replaced body line' }]);
    const a = text.split('\r\n');
    const b = out.split('\r\n');
    assert.equal(a.length, b.length, 'row count changed');
    let differing = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
    assert.equal(differing, 1, 'more than the edited row changed');
    assert.equal(b[44], 'Replaced body line');
    assert.equal(/(?<!\r)\n/.test(out), false, 'introduced a bare LF');
  });

  void   it('appends to the real table without shifting any existing index', async () => {
    let buf: Buffer;
    try {
      buf = await readFile(join(RAW_DIR, 'WorldDialog.txt'));
    } catch {
      return;
    }
    const text = buf.toString('latin1');
    const count = dialogStringCount(text);
    const { text: out, indices } = appendDialogStrings(text, ['Brand new dialog line']);
    assert.deepEqual(indices, [count]);
    const a = text.split('\r\n');
    const b = out.split('\r\n');
    for (let i = 0; i < count; i++) {
      assert.equal(a[i], b[i], `row ${String(i)} moved`);
    }
    assert.equal(dialogStringCount(out), count + 1);
  });
});
