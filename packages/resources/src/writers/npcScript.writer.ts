/**
 * Surgical writer for `raw/NpcScript.cpp` -- the yml -> .cpp return leg.
 *
 * NPC dialog logic lives in this file as one function per dialog state,
 * `void CNpcScript::<prefix>_<keyIdx>()`. The build-time converter
 * (`scripts/converters/dialogs.ts`) reduces each body to a
 * `data/dialogues/<prefix>.yml` state, and the runtime reads only the yml. But
 * `raw/` is the regenerable source of truth: an admin edit that lands only in
 * the yml is silently discarded the next time the converter runs. So an edit
 * must come back here too.
 *
 * The file is 28,541 CRLF lines of hand-authored C++ with Korean comments and a
 * UTF-8 BOM, and `game/source/WORLDDIALOG/NpcScript.cpp` is a byte-identical
 * compile input for the client-side DLL. Regenerating it is not an option --
 * this module replaces one function body at a time and leaves every other byte
 * where it was, including the per-NPC `// File : X.txt` header comments that
 * mark script group boundaries.
 *
 * @module writers/npcScript
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DialogKey, DialogState } from '../schemas/dialog.schema';
import { detectEol, escapeRe, splitLines } from './incStatements';

/** States to rewrite, keyed by dialog key index -- same shape as `DialogFile.states`. */
export interface NpcScriptEdit {
  readonly states: Readonly<Record<string, DialogState>>;
}

/** Located function: byte offsets of the body and of the whole declaration. */
interface FnRange {
  /** Offset of `void` -- start of the declaration. */
  readonly declStart: number;
  /** Offset just after the opening `{`. */
  readonly bodyStart: number;
  /** Offset of the matching `}`. */
  readonly bodyEnd: number;
}

/**
 * Locate `void CNpcScript::<prefix>_<keyIdx>()` and its brace-delimited body.
 *
 * The right-hand `(?![0-9])` guard matters: without it, a lookup for state `1`
 * would match `mafl_andy_10` and the writer would overwrite the wrong dialog
 * state.
 */
function findFn(text: string, prefix: string, keyIdx: string): FnRange | undefined {
  const re = new RegExp(
    `void\\s+CNpcScript::${escapeRe(prefix)}_${escapeRe(keyIdx)}(?![0-9])\\s*\\(\\s*\\)`,
  );
  const m = re.exec(text);
  if (!m) return undefined;

  let i = m.index + m[0].length;
  while (i < text.length && text[i] !== '{') i++;
  if (i >= text.length) return undefined;
  const bodyStart = i + 1;

  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { declStart: m.index, bodyStart, bodyEnd: i };
    }
  }
  return undefined;
}

/** Every keyIdx that already has a function for `prefix`, in file order. */
function existingKeys(text: string, prefix: string): string[] {
  const re = new RegExp(
    `void\\s+CNpcScript::${escapeRe(prefix)}_(\\d+)\\s*\\(\\s*\\)`,
    'g',
  );
  const out: string[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

// ── Body emission ────────────────────────────────────────────────────────────
//
// Emitted lines carry no indentation; `renderBody` applies the file's one-tab
// convention. Field order is fixed so a given state always produces the same
// bytes -- a converter-order-dependent emitter would churn the file on re-save.

/**
 * `AddKey( label[, key[, param]] )`.
 *
 * The arguments are positional in the C++, so a state carrying `param` without
 * `key` cannot be expressed and is rejected rather than emitted as a 2-arg call
 * that would route the choice to the wrong dialog state.
 */
function genKeyLine(k: DialogKey): string {
  if (k.param !== undefined && k.key === undefined) {
    throw new Error(
      `NpcScript.cpp: AddKey with param=${String(k.param)} but no key -- ` +
      `the C++ call is positional, so param cannot be written without key.`,
    );
  }
  const args = [k.label, k.key, k.param].filter((n) => n !== undefined);
  return `AddKey( ${args.map((n) => String(n)).join(', ')} );`;
}

/** Statement lines for a state's structured fields, in deterministic order. */
function genStatements(state: DialogState): string[] {
  const out: string[] = [];
  for (const n of state.speak ?? []) out.push(`Speak( NpcId(), ${String(n)} );`);
  for (const n of state.say ?? []) out.push(`Say( ${String(n)} );`);
  for (const k of state.keys ?? []) out.push(genKeyLine(k));
  if (state.launch_quest) out.push('LaunchQuest();');
  if (state.timer !== undefined) out.push(`SetScriptTimer( ${String(state.timer)} );`);
  if (state.exit) out.push('Exit();');
  return out;
}

/**
 * Render a state as a function body, EOLs included, ready to splice between the
 * braces.
 *
 * `source` wins over every structured field. Roughly 600 states use
 * conditionals, quest-state queries, and item ops that the converter could not
 * reduce; re-emitting those from `say`/`keys` alone would silently delete the
 * branching and hand every player the same dialog path. So a state that carries
 * `source` is written back verbatim -- the structured fields are a read-only
 * projection of it.
 */
function renderBody(state: DialogState, eol: string): string {
  const verbatim = state.source !== undefined;
  const lines = verbatim ? splitLines(state.source ?? '') : genStatements(state);
  if (lines.length === 0) return eol;
  // Only the first line is re-indented. A `source` body's continuation lines
  // carry the original author's own (often deeper) indentation, which is part of
  // the text the converter captured and must survive untouched.
  const rest = verbatim ? lines.slice(1) : lines.slice(1).map((l) => `\t${l}`);
  return `${eol}${[`\t${lines[0] ?? ''}`, ...rest].join(eol)}${eol}`;
}

/**
 * Insert a brand-new state's function immediately after the prefix's
 * highest-numbered existing one, keeping the group contiguous so the
 * `//Script Begin` / `//Script End` comment fences continue to bracket the whole
 * NPC.
 *
 * Throws when the prefix has no functions at all: creating a whole new script
 * group means picking a location among 4,244 functions and inventing the header
 * comment block, which is out of scope and must fail loudly rather than append
 * somewhere arbitrary.
 */
function insertFn(
  text: string,
  prefix: string,
  keyIdx: string,
  state: DialogState,
  eol: string,
): string {
  const keys = existingKeys(text, prefix);
  if (keys.length === 0) {
    throw new Error(
      `NpcScript.cpp: prefix "${prefix}" has no functions -- refusing to create a ` +
      `new script group. Add the group (with its // File : header) by hand first.`,
    );
  }
  const highest = keys.reduce((a, b) => (Number(b) > Number(a) ? b : a));
  const anchor = findFn(text, prefix, highest);
  if (!anchor) {
    throw new Error(`NpcScript.cpp: could not locate ${prefix}_${highest} to anchor insert`);
  }
  const at = anchor.bodyEnd + 1;
  const fn =
    `${eol}void CNpcScript::${prefix}_${keyIdx}()${eol}{${renderBody(state, eol)}}`;
  return text.slice(0, at) + fn + text.slice(at);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Pure: rewrite the bodies of `prefix`'s dialog states in decoded
 * `NpcScript.cpp` text.
 *
 * Only the bytes between each target function's braces change; signatures,
 * blank lines, comment fences, and all 4,000-odd other functions are left
 * exactly as found. A keyIdx with no existing function is inserted after the
 * prefix's last state.
 *
 * @param cppText - Decoded NpcScript.cpp (BOM already stripped).
 * @param prefix  - Function-name stem, lowercase, e.g. `mafl_andy`.
 * @param edit    - States to write, keyed by dialog key index.
 * @returns The modified text.
 */
export function applyNpcScriptEdit(
  cppText: string,
  prefix: string,
  edit: NpcScriptEdit,
): string {
  const eol = detectEol(cppText);
  let text = cppText;

  // Descending key order keeps earlier offsets valid across replacements and
  // makes a batch edit produce the same bytes regardless of object key order.
  const keys = Object.keys(edit.states).sort((a, b) => Number(b) - Number(a));
  for (const keyIdx of keys) {
    const state = edit.states[keyIdx];
    if (state === undefined) continue;
    const fn = findFn(text, prefix, keyIdx);
    if (!fn) {
      text = insertFn(text, prefix, keyIdx, state, eol);
      continue;
    }
    text = text.slice(0, fn.bodyStart) + renderBody(state, eol) + text.slice(fn.bodyEnd);
  }
  return text;
}

/**
 * I/O wrapper: read `raw/NpcScript.cpp`, apply the edit, write it back as UTF-8
 * with its BOM.
 *
 * The BOM is stripped before any regex work and re-added on write. It is not
 * decoration: the file is compiled by MSVC, which needs it to read the Korean
 * comments as UTF-8 rather than the system codepage.
 *
 * Only `rawDir` is touched. The duplicate at `game/source/WORLDDIALOG/` is a
 * separate compile input and is deliberately left alone.
 *
 * @param rawDir - Path to the `raw/` directory.
 * @param prefix - Function-name stem, e.g. `mafl_andy`.
 * @param edit   - States to write.
 */
export async function writeNpcScriptEdit(
  rawDir: string,
  prefix: string,
  edit: NpcScriptEdit,
): Promise<void> {
  const path = resolve(rawDir, 'NpcScript.cpp');
  const buf = await readFile(path);
  const { text, bom } = decode(buf);
  const out = applyNpcScriptEdit(text, prefix, edit);
  await writeFile(path, encode(out, bom));
}

// ── UTF-8 BOM codec ──────────────────────────────────────────────────────────

/** Strip a UTF-8 BOM if present, remembering whether to restore it. */
function decode(buf: Buffer): { text: string; bom: boolean } {
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  return { text: (bom ? buf.subarray(3) : buf).toString('utf8'), bom };
}

/** Encode as UTF-8, restoring the BOM when the input had one. */
function encode(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf8');
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}
