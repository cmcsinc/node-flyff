/**
 * Argument-level emitter for the `propQuest.inc` writer.
 *
 * ## The symbol-name-loss problem
 *
 * `scripts/converters/quests.ts` resolves every identifier argument through the
 * `#define` tables, so `II_SYS_SYS_QUE_BLADEBRAVERY` reaches the yml as
 * `{ type: 'sym', value: 1234 }`. The name is gone. Emitting `1234` back is
 * accepted by the client's scanner (`CScript::GetNumber` takes either form) but
 * turns a readable file into a wall of magic numbers and makes every diff span
 * the whole block.
 *
 * The fix is ordered, most-trustworthy first:
 *
 * 1. **Reuse the original token.** If the statement already exists in the file
 *    and the argument's numeric value is unchanged, the original text is kept
 *    VERBATIM -- whole lines, comments and all. This is the only branch that
 *    can never pick the wrong symbol, so it is preferred even when a reverse
 *    lookup would succeed.
 * 2. **Reverse-lookup within the original token's prefix bucket.** A changed
 *    value at a position that used to hold `II_*` is looked up in the `II_`
 *    bucket only (see `questSymbols.ts` -- a flat value->name map is ambiguous).
 * 3. **Reverse-lookup within a per-command prefix hint.** For an argument with
 *    no predecessor (a brand-new command), {@link ARG_PREFIX_HINTS} says which
 *    bucket that position uses. Best-effort and deliberately small.
 * 4. **Emit the literal number.** Always correct, just unreadable.
 *
 * @module writers/questEmit
 */

import type { QuestArg, QuestCommand } from '../schemas/quest.schema';
import { maskComments } from './questStatements';
import { symbolFor, symbolPrefix, type QuestWriterSymbols } from './questSymbols';

/**
 * Symbol prefix per command argument position, used only when synthesizing an
 * argument that has no counterpart in the file. Derived by tabulating every
 * call in the shipped `raw/propQuest.inc`; positions not listed here fall back
 * to a bare number.
 */
export const ARG_PREFIX_HINTS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  QuestItem: { 0: 'MI_', 1: 'II_' },
  SetQuestType: { 0: 'QT_' },
  SetDialog: { 0: 'QSAY_' },
  SetBeginCondJob: { 0: 'JOB_' },
  zSetBeginCondJob: { 0: 'JOB_' },
  SetBeginCondItem: { 3: 'II_' },
  SetBeginCondNotItem: { 3: 'II_' },
  SetBeginCondPreviousQuest: { 1: 'QUEST_' },
  SetBeginCondCharacter: { 1: 'WI_' },
  SetBeginSetAddItem: { 1: 'II_' },
  SetEndCondItem: { 3: 'II_' },
  SetEndCondOneItem: { 3: 'II_' },
  SetEndCondKillNPC: { 1: 'MI_' },
  SetEndCondPatrolZone: { 0: 'WI_', 5: 'PATROL_', 8: 'QUEST_' },
  SetEndRemoveItem: { 1: 'II_' },
  SetEndRewardItem: { 3: 'II_' },
  SetEndRewardItemWithAbilityOption: { 3: 'II_' },
};

/**
 * `SetBeginCondJob` and friends repeat one prefix across an unbounded argument
 * list, so a hint at index 0 applies to every later index too.
 */
function hintFor(cmd: string, index: number): string | undefined {
  const table = ARG_PREFIX_HINTS[cmd];
  if (!table) return undefined;
  return table[index] ?? (cmd.endsWith('CondJob') ? table[0] : undefined);
}

/** Split a masked argument list on top-level commas, returning [start,end) spans. */
function argSpans(masked: string, from: number, to: number): [number, number][] {
  const spans: [number, number][] = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = masked[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { spans.push([start, i]); start = i + 1; }
  }
  if (masked.slice(start, to).trim() !== '') spans.push([start, to]);
  return spans;
}

/**
 * Argument tokens of an existing statement, verbatim (whitespace trimmed).
 *
 * Returns `[]` when there is no argument list at all -- `SetEndRewardPetLevelup`
 * is written with an empty one, and that is not an error.
 *
 * The no-opening-paren branch exists for `QUEST_7`'s malformed second statement
 * (`JOB_RINGMASTER_MASTER, JOB_..._MASTER, ... );`, the tail of a duplicated
 * paste). The tokenizer reads its head token as the command name and everything
 * up to the `)` as arguments, so the writer has to read it the same way or the
 * statement's `JOB_*` symbols get re-emitted as bare numbers.
 */
export function originalArgTokens(statement: string): string[] {
  const masked = maskComments(statement);
  const open = masked.indexOf('(');
  if (open < 0) {
    const close = masked.indexOf(')');
    if (close < 0) return [];
    const head = /^\s*[A-Za-z_]\w*/.exec(masked)?.[0]?.length ?? 0;
    return argSpans(masked, head, close).map(([s, e]) => statement.slice(s, e).trim())
      .filter((t) => t !== '' && t !== ',');
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return [];
  return argSpans(masked, open + 1, close).map(([s, e]) => statement.slice(s, e).trim());
}

/**
 * Split a chunk's text into the statements the TOKENIZER sees.
 *
 * Normally one per chunk. Two shipped blocks make that untrue, and both have to
 * be handled or the positional pairing in `questGroups.rewriteSettingBody`
 * shifts and every later command is written over the wrong statement:
 *
 * - `QUEST_7` has two calls on one physical line (a duplicated paste):
 *   `SetBeginCondJob( JOB_MERCENARY, ... );JOB_RINGMASTER_MASTER, ... );`
 * - `QUEST_HEROMENT_TRN5` has `SetBeginCondPreviousQuest( 1, QUEST_... )` with
 *   NO terminating `;`, so the next `Set*` call shares its chunk.
 *
 * The C++ scanner (`Project.cpp:1457`) is equally indifferent to the missing
 * `;` -- it only counts braces and dispatches on head tokens -- so both forms
 * load fine in-game and must round-trip unchanged rather than be "fixed".
 *
 * A boundary is an identifier at paren depth <= 0 that follows either a `;` or a
 * completed argument list.
 */
export function splitStatements(text: string): string[] {
  const masked = maskComments(text);
  const out: string[] = [];
  let depth = 0;
  let complete = false;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i] ?? '';
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; if (depth <= 0) complete = true; continue; }
    if (c === ';' && depth <= 0) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
      complete = false;
      continue;
    }
    if (
      complete && depth <= 0 && i > start &&
      /[A-Za-z_]/.test(c) && !/[A-Za-z0-9_]/.test(masked[i - 1] ?? '')
    ) {
      out.push(text.slice(start, i));
      start = i;
      complete = false;
    }
  }
  if (text.slice(start).trim() !== '') out.push(text.slice(start));
  return out.length > 0 ? out : [text];
}

/** Head token of a statement text (`SetHeadQuest`), or `undefined`. */
export function statementHead(text: string): string | undefined {
  return /^\s*([A-Za-z_]\w*)/.exec(maskComments(text))?.[1];
}

/** Numeric/string value an original token denotes, for change detection. */
export function tokenValue(token: string, syms: QuestWriterSymbols): number | string | undefined {
  if (token.startsWith('"')) return token.slice(1, -1).replace(/"$/, '');
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
  if (token === 'TRUE') return 1;
  if (token === 'FALSE') return 0;
  return syms.byName.get(token) ?? token;
}

/** Does an existing statement already say exactly what `args` says? */
export function argsUnchanged(
  tokens: readonly string[],
  args: readonly QuestArg[],
  syms: QuestWriterSymbols,
): boolean {
  if (tokens.length !== args.length) return false;
  for (const [i, arg] of args.entries()) {
    const token = tokens[i];
    if (token === undefined) return false;
    const value = tokenValue(token, syms);
    if (arg.type === 'str') {
      if (value !== arg.value) return false;
    } else if (value !== arg.value) {
      return false;
    }
  }
  return true;
}

/** Emit one argument, applying the symbol-preservation ladder documented above. */
export function emitArg(
  cmd: string,
  index: number,
  arg: QuestArg,
  originalToken: string | undefined,
  syms: QuestWriterSymbols,
): string {
  if (arg.type === 'str') return `"${String(arg.value)}"`;
  if (arg.type === 'bool') return arg.value ? 'TRUE' : 'FALSE';
  if (typeof arg.value === 'string') return arg.value; // unresolved symbol, kept as written
  if (originalToken !== undefined && tokenValue(originalToken, syms) === arg.value) {
    return originalToken;
  }
  if (arg.type === 'sym') {
    const prefix = (originalToken !== undefined ? symbolPrefix(originalToken) : undefined)
      ?? hintFor(cmd, index);
    const sym = symbolFor(syms, prefix, arg.value);
    if (sym !== undefined) return sym;
  }
  return String(arg.value);
}

/**
 * Emit a whole command as one line, in the raw file's dominant style
 * (`SetHeadQuest( 6003 );` -- space inside the parens, none before them).
 *
 * `originalTokens` supplies the per-position symbol context; pass the tokens of
 * the statement being replaced when there is one.
 */
export function emitCommand(
  command: QuestCommand,
  originalTokens: readonly string[],
  syms: QuestWriterSymbols,
): string {
  const args = command.args.map((a, i) => emitArg(command.cmd, i, a, originalTokens[i], syms));
  if (args.length === 0) return `${command.cmd}();`;
  return `${command.cmd}( ${args.join(', ')} );`;
}
