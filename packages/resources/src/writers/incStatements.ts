/**
 * Statement scanner for `character.inc` -- locates whole statements (including
 * multi-line forms) so a writer can replace them IN PLACE without regenerating
 * the surrounding block.
 *
 * The raw file authors the same statement several ways, all of which occur:
 *
 * ```
 * AddMenu( MMI_TRADE  );          // one line, stray double space
 * m_szDialog= "MaFl_Marche.txt";  // assignment form
 * AddVendorSlot( 0,               // continuation breaks after a comma,
 * IDS_CHARACTER_INC_000052        // not after the paren
 * );
 * SetName                         // name and paren on separate lines
 * (
 * IDS_CHARACTER_INC_000051
 * );
 * ```
 *
 * So a statement is scanned by paren depth + terminating `;`, never by
 * "does this line end with `(`".
 *
 * @module writers/incStatements
 */

/** One located statement, in line coordinates. */
export interface IncStatement {
  /** Index of the statement's first line. */
  readonly start: number;
  /** Number of lines the statement spans (>= 1). */
  readonly count: number;
  /** Leading whitespace of the first line, reused when emitting a replacement. */
  readonly indent: string;
  /** The statement's raw text, lines joined with LF. */
  readonly text: string;
}

/** Escape a string for use inside a `RegExp`. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split on any newline variant. */
export function splitLines(s: string): string[] {
  return s.split(/\r\n|\r|\n/);
}

/** Dominant EOL of a text -- the raw files are CRLF and must stay CRLF. */
export function detectEol(s: string): '\r\n' | '\n' {
  return s.includes('\r\n') ? '\r\n' : '\n';
}

/** Drop a trailing `//` comment so it can't contribute parens or semicolons. */
function stripComment(line: string): string {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
}

/**
 * Find every statement whose head token is `name` (e.g. `AddMenu`,
 * `m_nStructure`, `SetFigure`). Matching is word-boundary-aware on the left so
 * `AddVendorItem` does not match `AddVendorItem2`; pass the exact head token.
 *
 * Scanning consumes lines until paren depth returns to zero AND a `;` is seen,
 * so all continuation styles in the raw file are captured as one statement.
 */
export function findStatements(lines: readonly string[], name: string): IncStatement[] {
  // Right boundary: reject an identifier char immediately after the name, so
  // `AddVendorItem` skips `AddVendorItem2(`.
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRe(name)}(?![A-Za-z0-9_])`);
  const out: IncStatement[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    if (first === undefined) continue;
    if (!re.test(stripComment(first))) continue;

    let depth = 0;
    let sawOpen = false;
    let j = i;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      if (raw === undefined) break;
      const bare = stripComment(raw);
      for (const c of bare) {
        if (c === '(') { depth++; sawOpen = true; }
        else if (c === ')') depth--;
      }
      // Statement ends at its `;`, once all parens have closed. This also
      // terminates the parenless assignment form (`m_nStructure= SRT_MAGIC;`)
      // on its first line.
      if (bare.includes(';') && depth <= 0) break;
      // Safety net for malformed input: never scan past a brace while still
      // outside any paren group, or a head token with no terminator would
      // swallow the rest of the block.
      if (!sawOpen && /[{}]/.test(bare) && j > i) { j--; break; }
    }
    if (j >= lines.length) j = lines.length - 1;

    out.push({
      start: i,
      count: j - i + 1,
      indent: /^\s*/.exec(first)?.[0] ?? '',
      text: lines.slice(i, j + 1).join('\n'),
    });
    i = j;
  }
  return out;
}

/**
 * Replace every statement named `name` with `replacements`, in place at the
 * first occurrence's position and indentation. When no occurrence exists, the
 * replacements are inserted at `fallbackPos`. Passing an empty `replacements`
 * deletes the statement outright.
 *
 * Mutates `lines`.
 */
export function replaceStatements(
  lines: string[],
  name: string,
  replacements: readonly string[],
  fallbackPos: number,
): void {
  const found = findStatements(lines, name);
  const pos = found[0]?.start ?? fallbackPos;
  const indent = found[0]?.indent ?? '\t\t';

  // Remove back-to-front so earlier indices stay valid.
  for (let k = found.length - 1; k >= 0; k--) {
    const stmt = found[k];
    if (stmt === undefined) continue;
    lines.splice(stmt.start, stmt.count);
  }
  if (replacements.length === 0) return;
  lines.splice(pos, 0, ...replacements.map((r) => indent + r.trimStart()));
}

/**
 * Index of the `}` line closing the block's inner `setting { }` group -- the
 * insertion point for a statement that belongs inside `setting` but is absent
 * from this block. Falls back to `lines.length` when there is no `setting` group.
 */
export function settingEnd(lines: readonly string[]): number {
  let i = lines.findIndex((l) => /^\s*setting\b/.test(stripComment(l)));
  if (i < 0) return lines.length;
  let depth = 0;
  let sawOpen = false;
  for (; i < lines.length; i++) {
    for (const c of stripComment(lines[i] ?? '')) {
      if (c === '{') { depth++; sawOpen = true; }
      else if (c === '}') depth--;
    }
    if (sawOpen && depth === 0) return i;
  }
  return lines.length;
}
