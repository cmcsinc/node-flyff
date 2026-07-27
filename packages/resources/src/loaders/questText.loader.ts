/**
 * propQuest string-table loader.
 *
 * Parses `raw/propQuest.txt.txt` (UTF-16LE, tab-separated) into a
 * `IDS_PROPQUEST_INC_XXXXXX -> display text` map. Quest titles + per-state
 * desc/cond/status reference these tokens; the schema keeps them verbatim and
 * the runtime resolves them here (mirrors C++ `m_aPropQuest` loading the text
 * table keyed by the IDS id).
 *
 * Format (one entry per line):  `IDS_PROPQUEST_INC_XXXXXX\tdisplay text`
 * Lines without a tab or with an empty key are skipped. The file ships UTF-16LE
 * with a BOM; we strip it like `characterInc.loader`.
 *
 * @module loaders/questText
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResourceLogger } from '../logger';

const logger = createResourceLogger('questText.loader');

/** Strip UTF-16LE BOM if present, then decode. */
function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

export type QuestTextIndex = Map<string, string>;

/**
 * Load + index `rawDir/propQuest.txt.txt`. Returns an empty map when the file
 * is absent (servers still boot; quest labels fall back to the def symbol).
 */
export async function loadQuestText(rawDir: string): Promise<QuestTextIndex> {
  const path = resolve(rawDir, 'propQuest.txt.txt');
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    logger.warn({ path }, 'propQuest.txt.txt not found -- quest titles unresolved');
    return new Map();
  }
  const out: QuestTextIndex = new Map();
  const text = decode(buf);
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const key = line.slice(0, tab).trim();
    if (!key) continue;
    out.set(key, line.slice(tab + 1).trim());
  }
  logger.info({ entries: out.size, path }, 'propQuest text loaded');
  return out;
}
