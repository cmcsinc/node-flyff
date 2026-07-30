/**
 * Chunk scanner for `propQuest.inc` -- the shape-preserving half of the quest
 * writer.
 *
 * `incStatements.ts` finds statements BY NAME, which is enough for
 * `character.inc` where the writer knows every statement it cares about. A
 * quest block instead holds an open-ended list of ~50 `Set*` commands that must
 * be rewritten as a group, so this module walks a body into an ordered sequence
 * of CHUNKS: each chunk is a run of leading trivia (blank lines, `//` and
 * `/* * /` comments) followed by exactly one statement. Rewriting a group then
 * means re-emitting chunks, which keeps every comment attached to the statement
 * it was written above:
 *
 * ```
 *   //머슈팡                                  <- trivia
 *   QuestItem(MI_MUSHPANG, II_..., 15, 1);    <- statement
 * ```
 *
 * Statement boundaries use the same rule as `incStatements.findStatements`
 * (paren depth back to zero AND a `;` seen) because the same multi-line
 * authoring styles occur here:
 *
 * ```
 * SetTitle
 * (
 *     IDS_PROPQUEST_INC_000005
 * );
 * SetDialog // 브로드에이의 퀘스트를 접수하고 있지 않았을 때
 * (
 *     0,
 *     IDS_PROPQUEST_INC_000345
 * );
 * ```
 *
 * @module writers/questStatements
 */

/** One statement plus the trivia lines written immediately above it. */
export interface QuestChunk {
  /** Blank/comment lines preceding the statement, verbatim. */
  readonly trivia: readonly string[];
  /** Head token (`SetDesc`, `QuestItem`, ...), or `undefined` for trivia-only tails. */
  readonly cmd: string | undefined;
  /** Leading whitespace of the statement's first line. */
  readonly indent: string;
  /** The statement's lines, verbatim. */
  readonly lines: readonly string[];
}

/** A `setting { }` / `state N { }` group located in line coordinates. */
export interface QuestGroup {
  /** Index of the line carrying the group keyword. */
  readonly head: number;
  /** Index of the first body line (after the `{` line). */
  readonly bodyStart: number;
  /** Index of the line carrying the closing `}` (exclusive body end). */
  readonly bodyEnd: number;
  /** The keyword as written -- `setting` and `Setting` both occur in the raw file. */
  readonly keyword: string;
}

/**
 * Blank out comments so structural scanning cannot see a `(`, `;`, `{` or `}`
 * that lives inside one. Length and newlines are preserved so an index into the
 * mask is also an index into the original text.
 *
 * The raw file needs both forms handled: `//` for the Korean annotations beside
 * commands, and `/* * /` for the nine whole quest blocks that are commented out.
 */
export function maskComments(text: string): string {
  const out = text.split('');
  let i = 0;
  let inStr = false;
  while (i < out.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') out[i++] = ' ';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n' && text[i] !== '\r') out[i] = ' ';
        i++;
      }
      if (i < text.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Mask an array of lines as one text so block comments span line boundaries. */
export function maskLines(lines: readonly string[]): string[] {
  return maskComments(lines.join('\n')).split('\n');
}

/** Does a masked line carry a statement head token? */
function headOf(masked: string): string | undefined {
  return /^\s*([A-Za-z_]\w*)/.exec(masked)?.[1];
}

/**
 * Walk body lines into chunks. Trailing trivia with no statement after it
 * becomes a final chunk with `cmd === undefined`, so the blank line the raw
 * file keeps before a group's `}` survives a rewrite.
 */
export function scanChunks(lines: readonly string[]): QuestChunk[] {
  const masked = maskLines(lines);
  const out: QuestChunk[] = [];
  let trivia: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = headOf(masked[i] ?? '');
    if (head === undefined) { trivia.push(lines[i] ?? ''); continue; }

    let depth = 0;
    let sawOpen = false;
    let j = i;
    for (; j < lines.length; j++) {
      const bare = masked[j] ?? '';
      for (const c of bare) {
        if (c === '(') { depth++; sawOpen = true; }
        else if (c === ')') depth--;
      }
      if (bare.includes(';') && depth <= 0) break;
      // Never run past a brace while outside any paren group: a head token with
      // no terminator would otherwise swallow the rest of the group.
      if (!sawOpen && /[{}]/.test(bare) && j > i) { j--; break; }
    }
    if (j >= lines.length) j = lines.length - 1;

    out.push({
      trivia,
      cmd: head,
      indent: /^\s*/.exec(lines[i] ?? '')?.[0] ?? '',
      lines: lines.slice(i, j + 1),
    });
    trivia = [];
    i = j;
  }
  if (trivia.length > 0) out.push({ trivia, cmd: undefined, indent: '', lines: [] });
  return out;
}

/** Flatten chunks back to lines. */
export function chunkLines(chunks: readonly QuestChunk[]): string[] {
  const out: string[] = [];
  for (const c of chunks) {
    out.push(...c.trivia);
    out.push(...c.lines);
  }
  return out;
}

/**
 * Locate a `setting { }` / `Setting { }` group, or a specific `state N { }`.
 *
 * `keywordRe` must anchor at line start and capture the keyword. The `{` is on
 * the same line for every `state` in the shipped file and on the next line for
 * every `setting`, so both are accepted.
 */
export function findGroup(
  lines: readonly string[],
  keywordRe: RegExp,
): QuestGroup | undefined {
  const masked = maskLines(lines);
  for (let i = 0; i < masked.length; i++) {
    const m = keywordRe.exec(masked[i] ?? '');
    if (!m) continue;
    // Find the `{` -- same line, or the first following non-blank line.
    let open = (masked[i] ?? '').includes('{') ? i : -1;
    if (open < 0) {
      for (let k = i + 1; k < masked.length; k++) {
        const next = (masked[k] ?? '').trim();
        if (next === '') continue;
        if (next.startsWith('{')) open = k;
        break;
      }
    }
    if (open < 0) continue;

    let depth = 0;
    for (let k = open; k < masked.length; k++) {
      for (const c of masked[k] ?? '') {
        if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      if (depth === 0) {
        return { head: i, bodyStart: open + 1, bodyEnd: k, keyword: m[1] ?? '' };
      }
    }
    return undefined;
  }
  return undefined;
}
