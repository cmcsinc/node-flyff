/**
 * Reverse symbol tables for the `propQuest.inc` writer.
 *
 * The quest converter resolves every `II_*` / `MI_*` / `JOB_*` / `QUEST_*`
 * token to a bare number, so the symbol NAME is not present in the parsed
 * `QuestDef` at all. Writing a quest back out from that state would replace
 * `II_SYS_SYS_QUE_BLADEBRAVERY` with `1234`. The client's own scanner accepts
 * the literal (`CScript::GetNumber` reads either), so it is not a crash --
 * but the file becomes unreadable and every diff is enormous.
 *
 * This module inverts the `#define` tables so a number can be turned back into
 * a name. One flat `number -> name` map is useless (value `1` is claimed by
 * hundreds of symbols across the headers), so the reverse map is bucketed by
 * symbol PREFIX (`II_`, `MI_`, `JOB_`, ...) and the writer picks a bucket from
 * the prefix the file itself already uses at that argument position.
 *
 * @module writers/questSymbols
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Forward + prefix-bucketed reverse `#define` tables. */
export interface QuestWriterSymbols {
  /** `SYMBOL -> value`, first-write-wins across all `define*.h`. */
  readonly byName: ReadonlyMap<string, number>;
  /** `prefix -> (value -> SYMBOL)`, e.g. `'II_' -> (1234 -> 'II_WEA_SWO_X')`. */
  readonly byPrefix: ReadonlyMap<string, ReadonlyMap<number, string>>;
}

/**
 * Prefix bucket for a symbol -- everything up to and including the first `_`.
 *
 * Coarse on purpose: `PATROL_DESTINATION_ID_0002` buckets as `PATROL_`, which
 * is still narrow enough that no two symbols in it share a value. Returns
 * `undefined` for a token with no underscore (not a define-style symbol).
 */
export function symbolPrefix(name: string): string | undefined {
  const i = name.indexOf('_');
  return i <= 0 ? undefined : name.slice(0, i + 1);
}

/**
 * Look up the symbol name for a numeric value inside one prefix bucket.
 * Returns `undefined` when the bucket has no such value -- the caller then
 * falls back to emitting the literal number.
 */
export function symbolFor(
  syms: QuestWriterSymbols,
  prefix: string | undefined,
  value: number,
): string | undefined {
  if (prefix === undefined) return undefined;
  return syms.byPrefix.get(prefix)?.get(value);
}

/** Decode a define header buffer (the v19 headers are UTF-16LE with BOM). */
function decodeHeader(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/**
 * Build {@link QuestWriterSymbols} from every `define*.h` in `rawDir`.
 *
 * FIRST-WRITE-WINS, matching `scripts/converters/questTokenize.ts`'s
 * `loadAllDefines`: `defineJob.h` defines the `JOB_*` symbols twice (original
 * numbering, then the `__3RD_LEGEND16` renumbering) and the converter resolved
 * quest arguments against the FIRST table. The writer must invert the same
 * table or a `JOB_*` argument would round-trip to a different job.
 */
export async function loadQuestSymbols(rawDir: string): Promise<QuestWriterSymbols> {
  const byName = new Map<string, number>();
  let files: string[] = [];
  try {
    files = (await readdir(rawDir)).filter((f) => /^define.*\.h$/i.test(f));
  } catch {
    return { byName, byPrefix: new Map() };
  }
  const re = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(-?\d+)/gm;
  for (const f of files) {
    const text = decodeHeader(await readFile(resolve(rawDir, f)));
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const sym = m[1];
      const raw = m[2];
      if (sym === undefined || raw === undefined) continue;
      if (!byName.has(sym)) byName.set(sym, Number.parseInt(raw, 10));
    }
  }
  return { byName, byPrefix: bucketByPrefix(byName) };
}

/** Invert a forward table into `prefix -> (value -> name)`, first-write-wins. */
export function bucketByPrefix(
  byName: ReadonlyMap<string, number>,
): ReadonlyMap<string, ReadonlyMap<number, string>> {
  const out = new Map<string, Map<number, string>>();
  for (const [name, value] of byName) {
    const prefix = symbolPrefix(name);
    if (prefix === undefined) continue;
    let bucket = out.get(prefix);
    if (!bucket) {
      bucket = new Map<number, string>();
      out.set(prefix, bucket);
    }
    if (!bucket.has(value)) bucket.set(value, name);
  }
  return out;
}
