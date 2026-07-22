/**
 * Tokenizer for the Flyff `.inc` resource format (propQuest.inc, propJob.inc, ...).
 *
 * The format is whitespace-heavy and command calls split freely across lines:
 *   SetTitle\n  (\n    IDS_X\n  );
 * so a regex-per-line parser (like the dialog converter) cannot work here.
 * This module flattens a source blob into a punct/ident/num/string token stream
 * that the quest block-walker consumes with a recursive-descent parser.
 *
 * @module scripts/converters/questTokenize
 */

export type Token =
  | { t: 'punct'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'num'; v: number };

const TOKEN_RE = /("(?:[^"\\]|\\.)*")|([A-Za-z_]\w*)|(-?\d+(?:\.\d+)?)|([{}(),;])/g;

/** Strip line comments and block comments (never inside strings here). */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      // Preserve string literals verbatim (a `//` inside one must not be stripped).
      out += ch;
      i++;
      while (i < src.length && src[i] !== '"') out += src[i++];
      if (i < src.length) out += src[i]!;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Tokenize a `.inc` source blob into a flat token stream. */
export function tokenize(src: string): Token[] {
  const clean = stripComments(src);
  const toks: Token[] = [];
  for (let m = TOKEN_RE.exec(clean); m !== null; m = TOKEN_RE.exec(clean)) {
    if (m[1] !== undefined) toks.push({ t: 'str', v: m[1].slice(1, -1) });
    else if (m[2] !== undefined) toks.push({ t: 'ident', v: m[2] });
    else if (m[3] !== undefined) toks.push({ t: 'num', v: Number(m[3]) });
    else if (m[4] !== undefined) toks.push({ t: 'punct', v: m[4] });
  }
  return toks;
}

/**
 * Load `#define SYM value` from every `define*.h` in `rawDir` into one map.
 * Used to resolve `MI_*`/`II_*`/`JOB_*`/`QT_*`/`QUEST_*` symbols to numbers.
 */
export async function loadAllDefines(rawDir: string): Promise<Map<string, number>> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const out = new Map<string, number>();
  let files: string[] = [];
  try {
    files = (await readdir(rawDir)).filter((f) => /^define.*\.h$/i.test(f));
  } catch {
    return out;
  }
  const re = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(-?\d+)/gm;
  for (const f of files) {
    const buf = await readFile(resolve(rawDir, f));
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
    for (let m = re.exec(text); m !== null; m = re.exec(text)) out.set(m[1], parseInt(m[2], 10));
  }
  return out;
}
