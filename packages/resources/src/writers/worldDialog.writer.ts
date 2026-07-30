/**
 * Writer for `raw/WorldDialog.txt` + `data/dialogues/_strings.yml`.
 *
 * WorldDialog.txt is a flat string table: line N (1-based) is the text the
 * world server resolves for `Say(n)` / `Speak(NpcId(), n)` where `n = N - 1`.
 * The client never reads it — dialog text crosses the wire as a string
 * (`User.cpp:6318` writes it, `DPClient.cpp:14354` reads it), so this file has
 * no client half to keep in sync.
 *
 * Line-index stability is the cardinal invariant. Every string's position is
 * load-bearing for the 4,244 `NpcScript.cpp` functions that reference it by
 * number, so this module only ever edits a line in place or appends past the
 * end. There is deliberately no insert and no delete: either would renumber
 * every later reference at once.
 *
 * Both halves are written together. The runtime loads `_strings.yml`
 * (`dialog.loader.ts:66`), not the `.txt`, but `raw/` is the regenerable source
 * of truth — writing only the yml means the next converter run silently
 * discards the edit.
 *
 * @module writers/worldDialog
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { detectEol, splitLines } from './incStatements';

/** One in-place replacement of an existing table row. */
export interface DialogStringEdit {
  /** 0-based table index — the same `n` that appears in `Say( n )`. */
  readonly index: number;
  /** Replacement text. Must be latin1-representable (see the codec note). */
  readonly text: string;
}

/**
 * Split a table into its rows, dropping the empty element a trailing newline
 * produces. Returned alongside the flag so the join can restore it — the real
 * file ends with CRLF and must keep doing so.
 */
function rows(txtText: string): { rows: string[]; trailingEol: boolean } {
  const lines = splitLines(txtText);
  const trailingEol = lines.length > 0 && lines[lines.length - 1] === '';
  return { rows: trailingEol ? lines.slice(0, -1) : lines, trailingEol };
}

function joinRows(list: readonly string[], trailingEol: boolean, eol: string): string {
  return trailingEol ? [...list, ''].join(eol) : list.join(eol);
}

/** Reject text that cannot survive the latin1 round-trip (see codec note). */
function assertLatin1(text: string, index: number): void {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) {
      throw new Error(
        `WorldDialog.txt row ${String(index)}: character ${JSON.stringify(ch)} ` +
        `is outside latin1 and would be written as a different byte. ` +
        `The file has no BOM and the DLL reads it byte-wise.`,
      );
    }
  }
}

/**
 * Pure: replace existing rows in a decoded string table.
 *
 * Every index must already exist. Appending is a separate operation
 * ({@link appendDialogStrings}) because it hands back the assigned indices the
 * caller must then write into a dialog state — silently extending here would
 * let a caller create text nothing references.
 */
export function applyDialogStringEdits(
  txtText: string,
  edits: readonly DialogStringEdit[],
): string {
  if (edits.length === 0) return txtText;
  const eol = detectEol(txtText);
  const { rows: list, trailingEol } = rows(txtText);

  for (const { index, text } of edits) {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      throw new Error(
        `WorldDialog.txt: row ${String(index)} does not exist ` +
        `(table has ${String(list.length)} rows). Use appendDialogStrings to add text.`,
      );
    }
    assertLatin1(text, index);
    list[index] = text;
  }
  return joinRows(list, trailingEol, eol);
}

/**
 * Pure: append new rows and report the index each was given.
 *
 * Append is the only way to add dialog text. The returned indices are what a
 * dialog state's `say` / `speak` / `keys` must reference.
 */
export function appendDialogStrings(
  txtText: string,
  newRows: readonly string[],
): { text: string; indices: number[] } {
  const eol = detectEol(txtText);
  const { rows: list, trailingEol } = rows(txtText);
  const indices: number[] = [];
  for (const text of newRows) {
    assertLatin1(text, list.length);
    indices.push(list.length);
    list.push(text);
  }
  return { text: joinRows(list, trailingEol, eol), indices };
}

/** Row count of a decoded table — the index the next appended row would get. */
export function dialogStringCount(txtText: string): number {
  return rows(txtText).rows.length;
}

/**
 * I/O wrapper: apply edits and/or appends to `raw/WorldDialog.txt`, then
 * regenerate `data/dialogues/_strings.yml` from the result so both halves agree
 * by construction rather than by two parallel edits.
 *
 * Near-atomic: both buffers are built before either write.
 *
 * @param rawDir  - Path to the `raw/` directory.
 * @param dataDir - Path to the `data/` root (the parent of `dialogues/`).
 * @param edit    - In-place row replacements and/or rows to append.
 * @returns Indices assigned to `edit.append`, in the order given.
 */
export async function writeDialogStrings(
  rawDir: string,
  dataDir: string,
  edit: {
    readonly edits?: readonly DialogStringEdit[];
    readonly append?: readonly string[];
  },
): Promise<number[]> {
  const txtPath = resolve(rawDir, 'WorldDialog.txt');
  const ymlPath = resolve(dataDir, 'dialogues', '_strings.yml');

  const txtBuf = await readFile(txtPath);
  let text = txtBuf.toString('latin1');

  if (edit.edits && edit.edits.length > 0) {
    text = applyDialogStringEdits(text, edit.edits);
  }
  let indices: number[] = [];
  if (edit.append && edit.append.length > 0) {
    const r = appendDialogStrings(text, edit.append);
    text = r.text;
    indices = r.indices;
  }

  // The converter's own shape (scripts/converters/dialogs.ts:22-28): the yaml
  // array is the file's rows with the trailing empty element dropped.
  const yml = stringify({ _version: '1.0', strings: rows(text).rows });

  await Promise.all([
    writeFile(txtPath, Buffer.from(text, 'latin1')),
    writeFile(ymlPath, yml, 'utf-8'),
  ]);
  return indices;
}

// ── Codec note ───────────────────────────────────────────────────────────────
// WorldDialog.txt has no BOM and is NOT valid UTF-8: rows 1069 and 1239 carry
// bytes 0xa1/0xb0 and 0xa2/0xdc (CP949 leftovers from the Korean original).
// A UTF-8 decode mangles them; latin1 maps bytes 0x00-0xff 1:1 onto codepoints
// 0x00-0xff, so `Buffer.from(buf.toString('latin1'), 'latin1')` is
// byte-identical. Verified against the real 136,930-byte file.
