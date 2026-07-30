/**
 * Quest block location for the `propQuest.inc` writer.
 *
 * Split out of `propQuest.writer.ts` to keep that file under the 300-line
 * ceiling; nothing here knows about editing, only about finding.
 *
 * @module writers/questBlocks
 */

import { escapeRe } from './incStatements';
import { maskComments } from './questStatements';

/** `[startOfKey, firstBodyOffset, offsetOfClosingBrace]` in decoded text. */
export type QuestBlockRange = readonly [number, number, number];

/**
 * Find a quest block's range in decoded `propQuest.inc` text.
 *
 * Scanning runs against a comment-MASKED copy (same length, so offsets carry
 * straight back to the original) for two reasons the shipped file forces: nine
 * whole quest blocks are wrapped in block comments and must stay invisible to a
 * lookup, and the Korean `//` annotations sit on the same lines as braces.
 *
 * The header is either a symbol (`QUEST_CHANGEJOB1`) or a bare numeric id
 * (`1992`), alone on its line, with `{` on the next line. The negative lookahead
 * stops `QUEST_1` from matching `QUEST_10`'s header.
 */
export function findBlockRange(text: string, key: string): QuestBlockRange | undefined {
  const masked = maskComments(text);
  const re = new RegExp(`^${escapeRe(key)}(?![\\w])[ \\t]*\\r?\\n\\s*\\{`, 'gm');
  const m = re.exec(masked);
  if (!m?.[0]) return undefined;
  const openIdx = m.index + m[0].length - 1;

  let depth = 1;
  let i = openIdx + 1;
  for (; i < masked.length && depth > 0; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') depth--;
  }
  if (depth !== 0) return undefined;
  return [m.index, openIdx + 1, i - 1];
}

/**
 * Pure: read the `SetTitle( IDS_* )` token out of a block.
 *
 * The title TEXT lives in `propQuest.txt.txt`, so setting a title means finding
 * this token and writing that row -- never rewriting the `.inc` statement.
 */
export function findQuestTitleToken(incText: string, key: string): string | undefined {
  const range = findBlockRange(incText, key);
  if (!range) return undefined;
  const body = maskComments(incText).slice(range[1], range[2]);
  return /\bSetTitle\s*\(\s*([A-Za-z_]\w*)\s*\)/.exec(body)?.[1];
}

/** Replace a group's body lines in place, returning a new line array. */
export function spliceBody(
  lines: readonly string[],
  bodyStart: number,
  bodyEnd: number,
  body: readonly string[],
): string[] {
  return [...lines.slice(0, bodyStart), ...body, ...lines.slice(bodyEnd)];
}
