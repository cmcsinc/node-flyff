/**
 * Surgical writer for `raw/propQuest.inc` + `raw/propQuest.txt.txt`.
 *
 * Edits individual statements inside a quest block without regenerating the
 * block from parsed state, so comments (including the Korean annotations and the
 * `/* ... * /` header note), blank lines, the multi-line `SetTitle\n(\n\tIDS_*\n);`
 * authoring style, and the per-block `setting` vs `Setting` casing all survive.
 *
 * ## Why this is stricter than the character.inc writer
 *
 * The game CLIENT parses `propQuest.inc` too: `resource.txt:132-133` packs it
 * into `data.res`, and `Project.cpp:495` `LoadPropQuest` has no
 * `__WORLDSERVER` guard. Output here is a client-facing artifact, so a malformed
 * block is a client crash rather than a server-side parse warning. Two
 * consequences are baked into the API:
 *
 * - {@link applyQuestEdit} NEVER creates a quest block. A new quest id that a
 *   stale client's `data.res` does not know is a crash risk, and minting one
 *   needs a deliberate separate path (with a client patch export).
 * - Removing a `state N` group is opt-in via {@link QuestEdit.removeStates}, not
 *   implied by omitting it from {@link QuestEdit.states}.
 *
 * @module writers/propQuest
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { QuestCommand, QuestState } from '../schemas/quest.schema';
import { nextTextToken, setTextEntry } from './characterInc.writer';
import { detectEol, escapeRe, splitLines } from './incStatements';
import { findBlockRange, findQuestTitleToken, spliceBody } from './questBlocks';
import { rewriteSettingBody, rewriteStateBody } from './questGroups';
import { findGroup } from './questStatements';
import { loadQuestSymbols, type QuestWriterSymbols } from './questSymbols';

export { findQuestTitleToken } from './questBlocks';
export type { QuestWriterSymbols } from './questSymbols';

/** Edit payload -- all fields optional; only set fields are written. */
export interface QuestEdit {
  /**
   * Quest title as plain text. Written into `propQuest.txt.txt` under the
   * token the block's existing `SetTitle` already names; the `.inc` half is not
   * touched. Requires a `SetTitle` statement in the block (every shipped block
   * has one).
   */
  title?: string;
  /**
   * Replaces the contents of the block's `setting { }` group.
   *
   * This is `QuestDef.commands` -- the whole condition/reward list. Statements
   * the converter routes elsewhere (`SetTitle`, `SetRemove`, `SetDialog`,
   * `QuestItem`) are NOT part of `commands` and are left in place.
   */
  commands?: readonly QuestCommand[];
  /**
   * Replaces the named `state N` groups, keyed by N as a string. States absent
   * from the record are untouched, byte for byte. A key with no matching group
   * in the file throws -- see {@link applyQuestEdit}.
   */
  states?: Readonly<Record<string, QuestState>>;
  /**
   * State numbers to DELETE from the block. Separate from {@link states} on
   * purpose.
   *
   * DANGER: a client running an older `data.res` still holds the quest's old
   * state count. `DPClient.cpp:8540` indexes
   * `pQuestProp->m_questState[ quest.m_nState ]` and dereferences the result
   * with no null guard, so removing a state a live character can still be
   * sitting in crashes that client on the next quest update. Only remove a
   * state you know no character occupies, and ship the client patch.
   */
  removeStates?: readonly string[];
  /**
   * Raw `IDS_* -> text` rows for `propQuest.txt.txt`.
   *
   * The `.inc` half only ever stores string-table TOKENS; the client resolves
   * them from its own copy of the table (`ProjectCmn.cpp:985`). Editing any
   * displayed string therefore needs this half too, or the client renders an
   * empty line.
   */
  texts?: Readonly<Record<string, string>>;
}

/** The string-table prefix `propQuest.txt.txt` uses. */
export const QUEST_TEXT_PREFIX = 'IDS_PROPQUEST_INC_';

// ── Helpers ──

/** Join lines with the EOL detected from the original text (the raw files are CRLF). */
function joinEol(lines: readonly string[], eol: '\r\n' | '\n'): string {
  return lines.join(eol);
}

// ── Public API ──

/**
 * Pure: apply an edit to decoded `propQuest.inc` text.
 *
 * @param incText - Decoded `propQuest.inc` (UTF-16LE decoded to a JS string).
 * @param key     - Block key: the symbol (`QUEST_CHANGEJOB1`) or the numeric id
 *                  form (`1992`), matching how the block's header is written.
 * @param edit    - Fields to change; only set fields are touched.
 * @param syms    - Reverse `#define` tables for symbol emission.
 * @returns The modified decoded text.
 * @throws When the block is absent (this writer never creates one), or when
 *         {@link QuestEdit.states} / {@link QuestEdit.removeStates} names a
 *         `state N` group the block does not have.
 */
export function applyQuestEdit(
  incText: string,
  key: string,
  edit: QuestEdit,
  syms: QuestWriterSymbols,
): string {
  const range = findBlockRange(incText, key);
  if (!range) {
    throw new Error(
      `propQuest.inc: block "${key}" not found. This writer never creates a quest ` +
      `block -- a new quest id crashes a client whose data.res predates it.`,
    );
  }
  const [, bodyStart, blockEnd] = range;
  const eol = detectEol(incText);
  let lines = splitLines(incText.slice(bodyStart, blockEnd));

  // States are rewritten before `setting` and in DESCENDING line order so an
  // earlier group's line count change cannot invalidate a later group's range.
  const stateEdits = collectStateEdits(lines, key, edit, syms);
  for (const { group, body } of stateEdits) {
    lines = body === null
      ? spliceBody(lines, group.head, group.bodyEnd + 1, [])
      : spliceBody(lines, group.bodyStart, group.bodyEnd, body);
  }

  if (edit.commands) {
    const setting = findGroup(lines, /^\s*([sS]etting)\b/);
    if (!setting) {
      throw new Error(
        `propQuest.inc: block "${key}" has no setting { } group -- cannot write commands. ` +
        `Add the group manually first; synthesizing one would guess its placement.`,
      );
    }
    const body = rewriteSettingBody(
      lines.slice(setting.bodyStart, setting.bodyEnd),
      edit.commands,
      syms,
    );
    lines = spliceBody(lines, setting.bodyStart, setting.bodyEnd, body);
  }

  return incText.slice(0, bodyStart) + joinEol(lines, eol) + incText.slice(blockEnd);
}

/** Per-state rewrite plan, ordered last-group-first. `body === null` = delete. */
interface StateEditPlan {
  readonly group: NonNullable<ReturnType<typeof findGroup>>;
  readonly body: string[] | null;
}

/**
 * Resolve every state edit to a line range + new body, sorted descending by
 * position. Locating all of them up front (against the untouched line array)
 * keeps the ranges consistent while they are applied one at a time.
 */
function collectStateEdits(
  lines: readonly string[],
  key: string,
  edit: QuestEdit,
  syms: QuestWriterSymbols,
): StateEditPlan[] {
  const plans: StateEditPlan[] = [];
  const locate = (n: string): NonNullable<ReturnType<typeof findGroup>> => {
    const group = findGroup(lines, new RegExp(`^\\s*(state)[ \\t]+${escapeRe(n)}(?![\\d])`));
    if (!group) {
      throw new Error(`propQuest.inc: block "${key}" has no "state ${n}" group`);
    }
    return group;
  };

  for (const n of edit.removeStates ?? []) {
    plans.push({ group: locate(n), body: null });
  }
  for (const [n, state] of Object.entries(edit.states ?? {})) {
    if (edit.removeStates?.includes(n)) continue;
    const group = locate(n);
    plans.push({
      group,
      body: rewriteStateBody(lines.slice(group.bodyStart, group.bodyEnd), state, syms),
    });
  }
  return plans.sort((a, b) => b.group.head - a.group.head);
}

/**
 * I/O wrapper: read both raw files, apply the edit, write both back as
 * UTF-16LE + BOM. Near-atomic -- both buffers are built before either write, so
 * a throw mid-apply leaves the pair untouched.
 *
 * @param rawDir - Path to the `raw/` directory.
 * @param key    - Block key (symbol or numeric id form).
 * @param edit   - Fields to change.
 */
export async function writeQuestEdit(
  rawDir: string,
  key: string,
  edit: QuestEdit,
): Promise<void> {
  const incPath = resolve(rawDir, 'propQuest.inc');
  const txtPath = resolve(rawDir, 'propQuest.txt.txt');

  const [incBuf, txtBuf] = await Promise.all([
    readFile(incPath),
    readFile(txtPath).catch(() => Buffer.alloc(0)),
  ]);

  const incText = decode(incBuf);
  let txtText = txtBuf.length > 0 ? decode(txtBuf) : '';

  if (edit.title !== undefined) {
    const token = findQuestTitleToken(incText, key);
    if (!token) {
      throw new Error(
        `propQuest.inc: block "${key}" has no SetTitle( IDS_* ) token -- ` +
        `cannot set its title without one.`,
      );
    }
    txtText = setQuestText(txtText, token, edit.title);
  }
  for (const [token, text] of Object.entries(edit.texts ?? {})) {
    txtText = setQuestText(txtText, token, text);
  }

  const syms = await loadQuestSymbols(rawDir);
  const incOut = encode(applyQuestEdit(incText, key, edit, syms));
  const txtOut = txtText ? encode(txtText) : txtBuf;

  await Promise.all([
    writeFile(incPath, incOut),
    txtBuf.length > 0 ? writeFile(txtPath, txtOut) : Promise.resolve(),
  ]);
}

/**
 * Pure: set an `IDS_*` row in decoded `propQuest.txt.txt`.
 *
 * Same `TOKEN<TAB>text` shape as `character.txt.txt`, so this delegates to the
 * character writer's tested implementation rather than duplicating the
 * append/trailing-newline handling.
 */
export function setQuestText(txtText: string, token: string, text: string): string {
  return setTextEntry(txtText, token, text);
}

/**
 * Lowest unused `IDS_PROPQUEST_INC_NNNNNN` token in the decoded table.
 * Thin alias over the shared implementation with this file's prefix bound.
 */
export function nextQuestTextToken(txtText: string): string {
  return nextTextToken(txtText, QUEST_TEXT_PREFIX);
}

// ── UTF-16LE codec (the raw files are UTF-16LE with a BOM) ──

/** Strip the UTF-16LE BOM if present, then decode. */
function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/** Encode text as UTF-16LE with a BOM prefix. */
function encode(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}
