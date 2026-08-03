/**
 * Apply prose rewrites produced by the chunk agents back into the raw tables.
 *
 * Each chunk agent wrote a JSON array of `{ id, text }` for ONLY the rows it
 * changed. This reads all `prose-out/*.json`, validates invariants, then edits
 * the rows in place via the tested writers so row counts and encodings hold.
 *
 * Quest id  = `IDS_PROPQUEST_INC_NNNNNN` token.
 * Dialog id = 0-based row index (stringified).
 *
 * `--check` validates without writing.
 *
 * @module scripts/applyProse
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = resolve(PKG_ROOT, 'raw');
const DATA_DIR = resolve(PKG_ROOT, 'data');
const OUT_DIR = resolve(process.env.CLAUDE_JOB_DIR ?? PKG_ROOT, 'tmp', 'prose-out');

interface Edit { id: string; text: string }

/** Reject any rewrite that breaks markup, latin1, or token constraints. */
function validate(edits: Edit[], latin1: boolean): Edit[] {
  const bad: string[] = [];
  for (const e of edits) {
    // id shape
    if (!/^IDS_PROPQUEST_INC_\d{6}$|^\d+$/.test(e.id)) bad.push(`bad id ${e.id}`);
    // literal \n preserved as the 2-char escape (count unchanged is caller's job)
    if (latin1) {
      for (const ch of e.text) {
        if ((ch.codePointAt(0) ?? 0) > 0xff) bad.push(`non-latin1 in ${e.id}: ${JSON.stringify(ch)}`);
      }
    }
    // no real newlines or tabs smuggled in
    if (e.text.includes('\n') || e.text.includes('\r') || e.text.includes('\t')) {
      bad.push(`control char in ${e.id}`);
    }
  }
  if (bad.length > 0) throw new Error(`invariant violations:\n${bad.slice(0, 20).join('\n')}`);
  return edits;
}

async function loadEdits(): Promise<Edit[]> {
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json'));
  const all: Edit[] = [];
  for (const f of files) {
    const arr = JSON.parse(await readFile(resolve(OUT_DIR, f), 'utf8')) as Edit[];
    all.push(...arr);
  }
  return all;
}

function applyQuest(text: string, edits: Map<string, string>): { text: string; n: number } {
  let n = 0;
  const out = text.split('\r\n').map((line) => {
    const tab = line.indexOf('\t');
    if (tab < 0) return line;
    const key = line.slice(0, tab);
    const newText = edits.get(key);
    if (newText === undefined) return line;
    n++;
    return `${key}\t${newText}`;
  });
  return { text: out.join('\r\n'), n };
}

function applyDialog(text: string, edits: Map<string, string>): { text: string; n: number } {
  let n = 0;
  const rows = text.split('\r\n');
  for (const [id, newText] of edits) {
    const i = Number(id);
    if (!Number.isInteger(i) || i < 0 || i >= rows.length) throw new Error(`dialog row ${id} out of range`);
    rows[i] = newText;
    n++;
  }
  return { text: rows.join('\r\n'), n };
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const all = await loadEdits();
  const questEdits = new Map(all.filter((e) => e.id.startsWith('IDS_')).map((e) => [e.id, e.text]));
  const dialogEdits = new Map(all.filter((e) => !e.id.startsWith('IDS_')).map((e) => [e.id, e.text]));

  validate([...questEdits].map(([id, text]) => ({ id, text })), false);
  validate([...dialogEdits].map(([id, text]) => ({ id, text })), true);

  process.stdout.write(`loaded ${String(questEdits.size)} quest + ${String(dialogEdits.size)} dialog rewrites\n`);

  const questBuf = await readFile(resolve(RAW_DIR, 'propQuest.txt.txt'));
  const questText = questBuf[0] === 0xff && questBuf[1] === 0xfe ? questBuf.subarray(2).toString('utf16le') : questBuf.toString('utf8');
  const dialogText = (await readFile(resolve(RAW_DIR, 'WorldDialog.txt'))).toString('latin1');

  const q = applyQuest(questText, questEdits);
  const d = applyDialog(dialogText, dialogEdits);
  process.stdout.write(`applied ${String(q.n)} quest + ${String(d.n)} dialog\n`);

  if (q.n !== questEdits.size || d.n !== dialogEdits.size) {
    throw new Error(`missing applies: quest ${String(q.n)}/${String(questEdits.size)}, dialog ${String(d.n)}/${String(dialogEdits.size)}`);
  }

  if (check) {
    process.stdout.write('--check: nothing written\n');
    return;
  }

  const rows = d.text.split('\r\n');
  const strings = rows.at(-1) === '' ? rows.slice(0, -1) : rows;
  const encode = (t: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]);

  await Promise.all([
    writeFile(resolve(RAW_DIR, 'propQuest.txt.txt'), encode(q.text)),
    writeFile(resolve(RAW_DIR, 'WorldDialog.txt'), Buffer.from(d.text, 'latin1')),
    writeFile(resolve(DATA_DIR, 'dialogues', '_strings.yml'), stringify({ _version: '1.0', strings }), 'utf-8'),
  ]);
  process.stdout.write('wrote raw + yml\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exitCode = 1;
});
