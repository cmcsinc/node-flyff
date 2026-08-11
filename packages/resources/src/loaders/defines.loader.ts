/**
 * `#define` symbol table loader.
 *
 * Parses every `raw/define*.h` (ANSI or UTF-16LE) into a single
 * `Map<symbol, number>` so runtime code can resolve `QUEST_*` / `II_*` /
 * `MI_*` / `JOB_*` tokens that appear verbatim in dialog `source:` bodies and
 * quest commands. Mirrors the build-time helper in
 * `scripts/converters/questTokenize.ts::loadAllDefines` -- same regex, same
 * UTF-16 sniff -- exposed for the runtime resource index.
 *
 * @module loaders/defines
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResourceLogger } from '../logger';

const logger = createResourceLogger('defines.loader');

/** `#define SYM value` -- value is a signed integer literal. */
const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(-?\d+)/gm;

/**
 * Parse one define header buffer to UTF-8 text, handling the UTF-16LE BOM the
 * v19 source files carry. Returns the symbol -> value pairs found inside.
 */
function parseDefineHeader(buf: Buffer): [string, number][] {
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  const out: [string, number][] = [];
  for (let m = DEFINE_RE.exec(text); m !== null; m = DEFINE_RE.exec(text)) {
    const sym = m[1];
    const raw = m[2];
    if (sym === undefined || raw === undefined) continue;
    out.push([sym, parseInt(raw, 10)]);
  }
  return out;
}

/**
 * Load every `define*.h` under `rawDir` into one symbol table.
 *
 * Empty / missing directory yields an empty map (the runtime falls back to
 * "unresolved symbol" -- never crashes).
 */
export async function loadDefines(rawDir: string): Promise<Map<string, number>> {
  const table = new Map<string, number>();
  let files: string[] = [];
  try {
    files = (await readdir(rawDir)).filter((f) => /^define.*\.h$/i.test(f));
  } catch (err) {
    logger.warn({ rawDir, err: (err as Error).message }, 'define*.h directory unreadable');
    return table;
  }

  let count = 0;
  for (const f of files) {
    const buf = await readFile(resolve(rawDir, f));
    for (const [sym, val] of parseDefineHeader(buf)) {
      if (!table.has(sym)) {
        table.set(sym, val);
        count++;
      }
    }
  }
  logger.info({ files: files.length, symbols: count }, 'Defines loaded');
  return table;
}
