/**
 * Group-body rewriters for the `propQuest.inc` writer -- the `setting { }` and
 * `state N { }` halves.
 *
 * Both work the same way: the body is scanned into chunks
 * (`questStatements.scanChunks`), the chunks this edit MANAGES are paired
 * positionally with the incoming data, and every other chunk -- comments, blank
 * lines, statements the converter extracts elsewhere -- is carried through
 * verbatim. A statement whose value did not change is not re-emitted at all;
 * its original lines are reused, which is what keeps `II_*`/`MI_*` symbol names
 * and the file's hand-authored spacing alive (see `questEmit.ts`).
 *
 * @module writers/questGroups
 */

import type { QuestCommand, QuestItem, QuestState } from '../schemas/quest.schema';
import { argsUnchanged, emitCommand, originalArgTokens, splitStatements, statementHead } from './questEmit';
import { chunkLines, scanChunks, type QuestChunk } from './questStatements';
import type { QuestWriterSymbols } from './questSymbols';

/**
 * Statements that live OUTSIDE the `setting { }` group, or that the converter
 * routes out of `QuestDef.commands` into their own field: `SetTitle` -> `title`,
 * `SetRemove` -> `no_remove`, `SetDialog` -> `dialog`,
 * `QuestItem` -> `quest_items`.
 *
 * They are filtered out of BOTH sides of the rewrite -- skipped when pairing
 * existing statements, and skipped when emitting the incoming list. Editing a
 * quest's conditions therefore cannot delete its "cannot be cancelled" flag or
 * its quest-item drops, and a `SetDialog` that an older converter build left in
 * `commands` cannot get relocated from the block's top level into `setting`
 * (where the C++ loader still reads it, but the file stops matching the shipped
 * authoring shape).
 */
const NON_COMMAND_STATEMENTS: ReadonlySet<string> = new Set([
  'SetTitle', 'SetRemove', 'SetDialog', 'QuestItem',
]);

/** Per-state text fields, in the order the raw file writes them. */
const STATE_FIELDS: readonly (readonly ['SetDesc' | 'SetCond' | 'SetStatus', keyof QuestState])[] = [
  ['SetDesc', 'desc'],
  ['SetCond', 'cond'],
  ['SetStatus', 'status'],
];

/** A bare identifier (`IDS_PROPQUEST_INC_000006`) stays bare; anything else is quoted. */
function emitTextToken(value: string): string {
  return /^[A-Za-z_]\w*$/.test(value) ? value : `"${value}"`;
}

/**
 * The multi-line call form the raw file uses for every `SetTitle` / `SetDesc` /
 * `SetCond` / `SetStatus`. Written as separate lines so the writer's output is
 * indistinguishable from hand-authored text.
 */
function multiLineCall(cmd: string, token: string, indent: string): string[] {
  return [`${indent}${cmd}`, `${indent}(`, `${indent}\t${token}`, `${indent});`];
}

/** Re-indent a generated one-line statement. */
function line(indent: string, text: string): QuestChunk {
  return { trivia: [], cmd: undefined, indent, lines: [indent + text] };
}

/**
 * Rewrite a `setting { }` body from a `commands` list.
 *
 * Pairing is POSITIONAL over STATEMENTS, not over lines: one chunk can hold more
 * than one statement (see `questEmit.splitStatements` -- `QUEST_7` has two calls
 * on one physical line), and the converter emits one command per statement. Each
 * chunk therefore claims as many incoming commands as it has statements. When
 * every one of them is unchanged, the chunk's original lines are kept
 * byte-identical -- that is what preserves symbol names and hand spacing.
 * Surplus commands are appended after the last statement; surplus statements are
 * dropped.
 */
export function rewriteSettingBody(
  lines: readonly string[],
  commands: readonly QuestCommand[],
  syms: QuestWriterSymbols,
): string[] {
  const chunks = scanChunks(lines);
  const generic = chunks.filter((c) => c.cmd !== undefined && !NON_COMMAND_STATEMENTS.has(c.cmd));
  const incoming = commands.filter((c) => !NON_COMMAND_STATEMENTS.has(c.cmd));
  const indent = generic[0]?.indent ?? '\t\t';

  const emitted: QuestChunk[] = [];
  let next = 0;
  for (const chunk of generic) {
    const subs = splitStatements(chunk.lines.join('\n'));
    const claimed = incoming.slice(next, next + subs.length);
    next += subs.length;
    if (claimed.length === 0) continue;
    emitted.push(...reemitChunk(chunk, subs, claimed, syms));
  }
  for (const command of incoming.slice(next)) {
    emitted.push({ ...line(indent, emitCommand(command, [], syms)), cmd: command.cmd });
  }

  return chunkLines(splice(chunks, generic, emitted));
}

/**
 * Re-emit one chunk against the commands that claimed its statements. Returns the
 * original chunk untouched when nothing changed; otherwise one generated line per
 * command, carrying the chunk's trivia so its comment stays attached.
 */
function reemitChunk(
  chunk: QuestChunk,
  subs: readonly string[],
  claimed: readonly QuestCommand[],
  syms: QuestWriterSymbols,
): QuestChunk[] {
  const unchanged =
    claimed.length === subs.length &&
    claimed.every((command, i) => {
      const sub = subs[i] ?? '';
      return statementHead(sub) === command.cmd
        && argsUnchanged(originalArgTokens(sub), command.args, syms);
    });
  if (unchanged) return [chunk];

  return claimed.map((command, i) => {
    const sub = subs[i];
    const tokens = sub === undefined ? [] : originalArgTokens(sub);
    return {
      trivia: i === 0 ? chunk.trivia : [],
      cmd: command.cmd,
      indent: chunk.indent,
      lines: [chunk.indent + emitCommand(command, tokens, syms)],
    };
  });
}

/**
 * Rewrite a `state N { }` body.
 *
 * `desc`/`cond`/`status` are replaced in place; a field absent from `state`
 * removes its statement, which is how a state loses a description. A field the
 * file does not carry yet is appended after the last managed statement.
 *
 * `quest_items` is only touched when the edit supplies it: the converter
 * aggregates every `QuestItem(...)` onto `QuestDef.quest_items` and leaves
 * `QuestState.quest_items` undefined, so treating undefined as "delete" would
 * silently strip a state's drop table on the first round-trip.
 */
export function rewriteStateBody(
  lines: readonly string[],
  state: QuestState,
  syms: QuestWriterSymbols,
): string[] {
  const chunks = scanChunks(lines);
  const managedCmds = new Set<string>(STATE_FIELDS.map(([cmd]) => cmd));
  if (state.quest_items !== undefined) managedCmds.add('QuestItem');
  const managed = chunks.filter((c) => c.cmd !== undefined && managedCmds.has(c.cmd));
  const indent = managed[0]?.indent ?? chunks.find((c) => c.cmd)?.indent ?? '\t\t';

  const emitted: QuestChunk[] = [];
  for (const [cmd, field] of STATE_FIELDS) {
    const value = state[field];
    if (typeof value !== 'string') continue;
    const original = managed.find((c) => c.cmd === cmd);
    const token = emitTextToken(value);
    if (original && originalArgTokens(original.lines.join('\n'))[0] === token) {
      emitted.push(original);
    } else {
      emitted.push({
        trivia: original?.trivia ?? [],
        cmd,
        indent: original?.indent ?? indent,
        lines: multiLineCall(cmd, token, original?.indent ?? indent),
      });
    }
  }
  if (state.quest_items !== undefined) {
    emitted.push(...state.quest_items.map((qi) => emitQuestItem(qi, managed, indent, syms)));
  }

  return chunkLines(splice(chunks, managed, emitted));
}

/**
 * One `QuestItem( MI_*, II_*, prob, num )` line. Reuses an existing statement
 * with the same four values verbatim so its Korean monster-name comment and
 * symbol tokens survive.
 */
function emitQuestItem(
  qi: QuestItem,
  managed: readonly QuestChunk[],
  indent: string,
  syms: QuestWriterSymbols,
): QuestChunk {
  const command: QuestCommand = {
    cmd: 'QuestItem',
    args: [
      { type: 'sym', value: qi.mover },
      { type: 'sym', value: qi.item },
      { type: 'num', value: qi.prob },
      { type: 'num', value: qi.num },
    ],
  };
  for (const c of managed) {
    if (c.cmd !== 'QuestItem') continue;
    const tokens = originalArgTokens(c.lines.join('\n'));
    if (argsUnchanged(tokens, command.args, syms)) return c;
  }
  const near = managed.find((c) => c.cmd === 'QuestItem');
  const tokens = near ? originalArgTokens(near.lines.join('\n')) : [];
  return { ...line(near?.indent ?? indent, emitCommand(command, tokens, syms)), cmd: 'QuestItem' };
}

/**
 * Replace the `managed` chunks inside `chunks` with `emitted`, at the position
 * of the first managed chunk. Chunks that are not managed keep their order and
 * content, so comments between two rewritten statements stay put.
 */
function splice(
  chunks: readonly QuestChunk[],
  managed: readonly QuestChunk[],
  emitted: readonly QuestChunk[],
): QuestChunk[] {
  if (managed.length === 0) {
    // Nothing to replace: insert before any trailing trivia-only chunk so a new
    // statement lands inside the group rather than after its blank tail.
    const tailIdx = chunks.findIndex((c) => c.cmd === undefined);
    const at = tailIdx < 0 ? chunks.length : tailIdx;
    return [...chunks.slice(0, at), ...emitted, ...chunks.slice(at)];
  }
  const managedSet = new Set(managed);
  const out: QuestChunk[] = [];
  let placed = false;
  for (const c of chunks) {
    if (managedSet.has(c)) {
      if (!placed) { out.push(...emitted); placed = true; }
      continue;
    }
    out.push(c);
  }
  if (!placed) out.push(...emitted);
  return out;
}
