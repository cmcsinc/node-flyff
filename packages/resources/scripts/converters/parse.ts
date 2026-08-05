/**
 * Shared parsers for the original Flyff resource formats.
 *
 * Handles the four source idioms used by `raw/`:
 *  - `prop*.txt` tab-tables (UTF-8 or UTF-16LE, `//`-prefixed header row, `=` = inherit-previous)
 *  - `define*.h` enum headers (`#define SYM  value`)
 *  - `*.txt.txt` display-name tables (UTF-16LE, `ID\tName`)
 *
 * @module scripts/converters/parse
 */

import { readFile } from 'node:fs/promises';

import { stripBlockComments } from '../../src/defineHeader.js';

/** Flyff `=` cell means "same value as the previous row" -- resolve it. */
const INHERIT = '=';

export type Row = Record<string, string>;

/**
 * Read a source file, auto-detecting UTF-16LE via BOM, else UTF-8.
 * Korean comments are irrelevant to data extraction; ASCII columns decode under either.
 */
export async function readSource(path: string): Promise<string> {
  const buf = await readFile(path);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/**
 * Parse a `prop*.txt` tab-table into rows keyed by the `//`-header column names.
 *
 * - Header = the first `//`-prefixed line containing `dwID` (Flyff's universal id column).
 * - Cells equal to `=` inherit the previous row's value for that column (Flyff convention).
 * - Trailing whitespace per cell is trimmed; rows missing `dwID`/`szName` are skipped.
 */
export function parsePropTable(content: string): Row[] {
  const lines = content.split(/\r?\n/);

  let headerIdx = lines.findIndex((l) => l.startsWith('//') && l.includes('dwID'));
  if (headerIdx === -1) {
    // Fallback: first // line with at least 3 tab-separated tokens
    headerIdx = lines.findIndex((l) => l.startsWith('//') && l.split('\t').length >= 3);
  }
  if (headerIdx === -1) throw new Error('No header row found (//dwID ...)');

  const columns = lines[headerIdx]
    .split('\t')
    .map((c) => c.trim().replace(/^\/\/+/, ''))
    .filter((c) => c.length > 0);

  const rows: Row[] = [];
  const last: Record<string, string> = {};

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.startsWith('//')) continue;

    const cells = line.split('\t');
    const row: Row = {};

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      let val = (cells[c] ?? '').trim();
      if (val === INHERIT) val = last[col] ?? '';
      if (val.length > 0) {
        row[col] = val;
        last[col] = val;
      }
    }

    if (row.dwID && row.szName) rows.push(row);
  }

  return rows;
}

/**
 * Re-export of the shared header helper (`src/defineHeader.ts`) so the converter
 * modules keep importing block-comment stripping from `./parse.js`.
 */
export { stripBlockComments };

/**
 * Parse a `define*.h` header into `SYM -> numeric value`.
 * e.g. `#define MI_AIBATT1   20` -> { 'MI_AIBATT1': 20 }
 *
 * @param prefix - only capture symbols starting with this (e.g. `MI_`, `II_`, `SI_`)
 */
export function parseDefines(content: string, prefix: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(`^\\s*#define\\s+(${prefix}\\w+)\\s+(\\d+)`, 'gm');
  // First-write-wins on the COMMENT-STRIPPED text -- matches `loadAllDefines`
  // (questTokenize.ts). Some define files (e.g. defineJob.h) still carry
  // duplicate symbols in separate LIVE sections (original vs 3RD_LEGEND16
  // renumbering); the first matches the numbering the quest/item/drop data and
  // stored player state use, so keep it. What we must NOT do is let a dead
  // commented-out section win -- hence `stripBlockComments` first.
  const live = stripBlockComments(content);
  for (let m = re.exec(live); m !== null; m = re.exec(live)) {
    if (!out.has(m[1])) out.set(m[1], parseInt(m[2], 10));
  }
  return out;
}

/**
 * Parse a `*.txt.txt` display-name table (UTF-16LE-decoded) into `IDS_KEY -> display name`.
 * Lines look like `IDS_PROPITEM_TXT_000002\tHand`. Empty display names are skipped.
 */
export function parseTxtTxt(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const key = line.slice(0, tab).trim();
    const name = line.slice(tab + 1).trim();
    if (key.startsWith('IDS_') && name.length > 0) out.set(key, name);
  }
  return out;
}

/**
 * Resolve a cell that may be numeric OR a Flyff symbol (`WT_RANGE_BOW`,
 * `DST_STR`, `JOB_VAGRANT`...) to its numeric value via a defines map. `=`
 * is treated as absent (it is resolved to the prior row's literal by
 * {@link parsePropTable} before reaching here, but defensive). Returns
 * `undefined` when the token is absent or has no defines entry -- the caller
 * decides whether that means "skip" vs "0".
 */
export function symbol(
  defines: Map<string, number>,
  token: string | undefined,
): number | undefined {
  if (!token || token === '=' || token === '') return undefined;
  const n = Number(token);
  if (Number.isFinite(n)) return n;
  return defines.get(token);
}

/** Parse a numeric cell, returning `fallback` when absent / non-numeric. */
export function num(row: Row, col: string, fallback = 0): number {
  const v = row[col];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Shrink a Flyff symbol for use as a YAML id slug (`MI_AIBATT1` -> `aibatt1`). */
export function slug(symbol: string, dropPrefix: string): string {
  return symbol.replace(dropPrefix, '').toLowerCase();
}
