/**
 * Mechanical text normalizer for `raw/propQuest.txt.txt` + `raw/WorldDialog.txt`.
 *
 * Fixes only defects a regex can prove: whitespace, punctuation runs, CP949
 * leftovers, and a short table of hand-verified one-offs. Grammar and wording
 * are deliberately out of scope — those need a human or a model reading the
 * sentence, and mixing them into this pass would make the diff unreviewable.
 *
 * Both files are string tables addressed by position: propQuest by `IDS_*`
 * token, WorldDialog by 0-based line index. Row count and row order are
 * load-bearing (`NpcScript.cpp` references dialog rows by number), so this
 * script only ever rewrites the text *inside* a row.
 *
 * `--check` reports without writing. Default writes both raw files plus
 * `data/dialogues/_strings.yml`, which is what the runtime actually loads.
 *
 * @module scripts/fixText
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = resolve(PKG_ROOT, 'raw');
const DATA_DIR = resolve(PKG_ROOT, 'data');

/** Rows whose text is Korean are left untouched — see korean-strings report. */
const KOREAN = /[가-힯ᄀ-ᇿ㄰-㆏]/;

/**
 * Hand-verified replacements that no general rule should own.
 *
 * The CP949 pairs are real bytes in the shipped file: 0xa1b0/0xa1b1 are the
 * Korean codepage's curly quotes and 0xa2dc is an eighth note. Read as latin1
 * they surface as `¡°`, `¡±`, `¢Ü` and render as mojibake on a Western
 * codepage, so they become their ASCII intent instead.
 */
const LITERAL: readonly (readonly [string, string])[] = [
  ['¡°', '"'],           // CP949 0xa1b0 — opening curly quote
  ['¡±', '"'],           // CP949 0xa1b1 — closing curly quote
  ['¢Ü', ''],            // CP949 0xa2dc — decorative eighth note
  ['Speed ??like', 'Speed like'],  // dropped char, not emphasis
  ['Speed ??enough', 'Speed enough'],
  ['inventory."""', 'inventory."'],
  ['Dr.Estly', 'Dr. Estly'],
  ['Glaphans.Will', 'Glaphans. Will'],
];

/**
 * Normalize one row's text.
 *
 * Order matters: literals run first so their output is then whitespace-normalized
 * (dropping the eighth note leaves a trailing space that the trim must catch).
 */
export function fixRow(input: string): string {
  if (KOREAN.test(input)) return input;
  let t = input;

  for (const [from, to] of LITERAL) t = t.split(from).join(to);

  // Periods: 2+ in a row are always an ellipsis in these files, never real
  // sentence punctuation. `.. ..` (Q1923) collapses to one ellipsis too.
  t = t.replace(/\.{2,}(\s*\.{2,})*/g, '...');
  // Doubled non-period punctuation: `!!` / `?!?` are intentional emphasis and
  // stay; only a comma or semicolon run is a typo.
  t = t.replace(/([,;:])\1+/g, '$1');

  // Space before punctuation is never correct in English prose.
  t = t.replace(/[ \t]+([,.!?;:])/g, '$1');
  // Missing space after a comma/semicolon/colon, but not inside 1,000 or 12:30.
  t = t.replace(/([,;])(?=[A-Za-z])/g, '$1 ');

  // Standalone lowercase pronoun.
  t = t.replace(/(^|[^\p{L}'])i(?=[^\p{L}']|$)/gu, '$1I');

  // Collapse runs of spaces. The quest table mixes one and two spaces after a
  // sentence (2155 vs 1733) while the dialog table is uniformly one, so one wins.
  // `\n` here is the two-character escape the client expands, not a newline.
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/[ \t]+(\\n)/g, '$1').replace(/(\\n)[ \t]+/g, '$1');

  return t.trim();
}

/** Strip the UTF-16LE BOM if present, else decode as latin1 (WorldDialog). */
function decodeQuest(buf: Buffer): string {
  return buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
}

function encodeQuest(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

interface Change { readonly id: string; readonly before: string; readonly after: string }

/** Rewrite `TOKEN\ttext` rows, leaving keyless rows (blank lines) alone. */
function fixQuestTable(text: string): { text: string; changes: Change[] } {
  const changes: Change[] = [];
  const out = text.split('\r\n').map((line) => {
    const tab = line.indexOf('\t');
    if (tab < 0) return line;
    const key = line.slice(0, tab);
    const before = line.slice(tab + 1);
    const after = fixRow(before);
    if (after !== before) changes.push({ id: key, before, after });
    return `${key}\t${after}`;
  });
  return { text: out.join('\r\n'), changes };
}

function fixDialogTable(text: string): { text: string; changes: Change[] } {
  const changes: Change[] = [];
  const out = text.split('\r\n').map((before, i) => {
    const after = fixRow(before);
    if (after !== before) changes.push({ id: `row ${String(i)}`, before, after });
    return after;
  });
  return { text: out.join('\r\n'), changes };
}

function report(label: string, changes: readonly Change[], verbose: boolean): void {
  process.stdout.write(`${label}: ${String(changes.length)} rows changed\n`);
  if (!verbose) return;
  for (const c of changes.slice(0, 40)) {
    process.stdout.write(`  ${c.id}\n    - ${JSON.stringify(c.before)}\n    + ${JSON.stringify(c.after)}\n`);
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const verbose = process.argv.includes('--verbose');

  const questPath = resolve(RAW_DIR, 'propQuest.txt.txt');
  const dialogPath = resolve(RAW_DIR, 'WorldDialog.txt');
  const ymlPath = resolve(DATA_DIR, 'dialogues', '_strings.yml');

  const [questBuf, dialogBuf] = await Promise.all([readFile(questPath), readFile(dialogPath)]);

  const quest = fixQuestTable(decodeQuest(questBuf));
  // latin1 round-trips every byte 1:1; the file is not valid UTF-8 (CP949 leftovers).
  const dialog = fixDialogTable(dialogBuf.toString('latin1'));

  report('propQuest.txt.txt', quest.changes, verbose);
  report('WorldDialog.txt', dialog.changes, verbose);

  if (check) {
    process.stdout.write('--check: nothing written\n');
    return;
  }

  const rows = dialog.text.split('\r\n');
  const strings = rows.at(-1) === '' ? rows.slice(0, -1) : rows;

  await Promise.all([
    writeFile(questPath, encodeQuest(quest.text)),
    writeFile(dialogPath, Buffer.from(dialog.text, 'latin1')),
    writeFile(ymlPath, stringify({ _version: '1.0', strings }), 'utf-8'),
  ]);
  process.stdout.write('wrote raw/propQuest.txt.txt, raw/WorldDialog.txt, data/dialogues/_strings.yml\n');
}

if (process.argv[1] !== undefined && import.meta.url.endsWith('fixText.ts')) {
  main().catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
  });
}
