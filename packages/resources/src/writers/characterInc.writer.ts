/**
 * Surgical writer for `raw/character.inc` + `raw/character.txt.txt`.
 *
 * Edits individual statements inside character.inc blocks without
 * regenerating the block from parsed state. Preserves comments, blank lines,
 * and all whitespace outside the edited statements. Writes both files back as
 * UTF-16LE with BOM so the game client's own parser (which expects that
 * encoding) sees byte-identical markers.
 *
 * @module writers/characterInc
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CharacterIncEquipPart, CharacterIncVendorTab, CharacterIncVendorItem, CharacterIncVendorItemId } from '../loaders/characterInc.loader';

/** Reverse-lookup maps needed by the writer to emit SYMBOL names, not raw ids. */
export interface WriterSymbols {
  /** MMI_ numeric id -> symbol (e.g. `2` -> `MMI_TRADE`). */
  readonly mmiById: ReadonlyMap<number, string>;
  /** II_ numeric id -> symbol (e.g. `1` -> `II_ARM_M_VAG_QUE_HELMET`). */
  readonly iiById: ReadonlyMap<number, string>;
  /** SRT_ numeric id -> symbol (e.g. `4` -> `SRT_WEAPON`). */
  readonly srtById: ReadonlyMap<number, string>;
}

/** Edit payload -- all fields optional; only set fields are written. */
export interface CharacterEdit {
  /** Display name. Written to character.txt.txt under the block's SetName IDS_* token. */
  name?: string;
  /** MMI_* numeric ids. Replaces all existing AddMenu/AddMenuLang lines. */
  menus?: readonly number[];
  /** Outfit. `null` removes both SetFigure + SetEquip. Non-null rewrites them. */
  outfit?: {
    hairMesh: number;
    hairColor: number;
    headMesh: number;
    equip: readonly { parts: number; itemId: number }[];
  } | null;
  /** `m_szDialog` filename. Replaces existing or inserts at end of block. */
  dialogFile?: string | null;
  /** `SetOutput( TRUE|FALSE )`. Replaces or inserts. */
  output?: boolean;
  /** `m_nStructure= SRT_*;` value. `null` removes the line. */
  structure?: number | null;
  /** `AddVendorSlot( n, IDS_* )` entries. Replaces all existing. */
  vendorTabs?: readonly { slot: number; label: string }[];
  /** `AddVendorItem( n, IK3_*, job, minU, maxU, totalNum )` entries. Replaces all existing. */
  vendorItems?: readonly CharacterIncVendorItem[];
  /** `AddVendorItem2( n, dwId )` entries. Replaces all existing. */
  vendorItemIds?: readonly CharacterIncVendorItemId[];
}

// ── Block range finder (reuses brace-depth logic from parseCharacterInc) ──

/**
 * Find the `[start, end)` range of a `<key> { ... }` block in decoded text.
 * Operates on ORIGINAL text (comments preserved) -- unlike `parseCharacterInc`
 * which strips comments first. Nested braces inside the block body are counted
 * so an inner `if(...) { }` inside a block does not prematurely close it.
 *
 * Returns `[startOfKey, positionAfterClosingBrace]`, or `undefined` if the
 * block key is not found.
 */
function findBlockRange(text: string, key: string): [number, number] | undefined {
  const re = new RegExp(`^${escapeRe(key)}\\s*\\{`, 'gm');
  const m = re.exec(text);
  if (!m?.[0] || m.index === undefined) return undefined;
  const openIdx = text.indexOf('{', m.index + m[0].length - 1);
  if (openIdx < 0) return undefined;
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return undefined;
  return [m.index, i];
}

/** Escape a string for use inside a `RegExp`. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Line-based helpers (normalized to LF) ──

/** Split decoded text on any newline variant, preserving the content of each line. */
function splitLines(s: string): string[] {
  return s.split(/\r\n|\r|\n/);
}

/** Join lines with a single LF. */
function joinLines(lines: string[]): string {
  return lines.join('\n');
}

/** Regex that matches a statement on one or two consecutive lines. */
function stmtRe(firstLine: string): RegExp {
  return new RegExp(escapeRe(firstLine) + '(?:\\s*\\n\\s*\\S[^\n]*)?', 'g');
}

/**
 * Find a statement in `lines` that matches `stmtPattern` (single-line form).
 * Handles two-line forms where the first line ends with an unclosed `(` by
 * joining the two lines before matching.
 *
 * Returns `[startLine, matchedText]` or `undefined`.
 */
function findStatement(lines: string[], stmtPattern: string): [number, string] | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.replace(/\s+$/, '');
    const endsWithOpen = trimmed.endsWith('(') && !trimmed.includes(')');
    if (endsWithOpen && i + 1 < lines.length) {
      const joined = trimmed + ' ' + lines[i + 1]!.replace(/^\s+/, '');
      const re = stmtRe(stmtPattern);
      const m = re.exec(joined);
      if (m) return [i, m[0]];
    }
    const re = stmtRe(stmtPattern);
    const m = re.exec(line);
    if (m) return [i, m[0]];
  }
  return undefined;
}

/**
 * Find ALL occurrences of a statement pattern in `lines`.
 * Returns an array of `[startLineIndex, lineCount]` for each match.
 */
function findAllStatements(lines: string[], stmtPattern: string): Array<[number, number]> {
  const results: Array<[number, number]> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.replace(/\s+$/, '');
    const endsWithOpen = trimmed.endsWith('(') && !trimmed.includes(')');
    if (endsWithOpen && i + 1 < lines.length) {
      const joined = trimmed + ' ' + lines[i + 1]!.replace(/^\s+/, '');
      const re = stmtRe(stmtPattern);
      const m = re.exec(joined);
      if (m) { results.push([i, 2]); i += 2; continue; }
    }
    const re = stmtRe(stmtPattern);
    const m = re.exec(line);
    if (m) { results.push([i, 1]); i += 1; continue; }
    i++;
  }
  return results;
}

/** Remove lines `[startLine, startLine+lineCount)` from `lines`, mutating in place. */
function removeLines(lines: string[], startLine: number, lineCount: number): void {
  lines.splice(startLine, lineCount);
}

/** Insert `newLines` at `pos` into `lines`, mutating in place. */
function insertLines(lines: string[], pos: number, newLines: readonly string[]): void {
  lines.splice(pos, 0, ...newLines);
}

/** Remove ALL occurrences of a statement pattern from `lines`. Returns the line index of the first removed occurrence (or -1). */
function removeAllStatements(lines: string[], stmtPattern: string): number {
  const matches = findAllStatements(lines, stmtPattern);
  let firstIdx = -1;
  for (let j = matches.length - 1; j >= 0; j--) {
    const [startLine, lineCount] = matches[j]!;
    if (j === 0) firstIdx = startLine;
    removeLines(lines, startLine, lineCount);
  }
  return firstIdx;
}

/** Escape a string for use inside a regex pattern (meta-characters only, no boundary). */
function reEscape(s: string): string {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, (ch) => {
    if (/\s/.test(ch)) return '\\s+';
    return '\\' + ch;
  });
}

/** Build a regex from a generator-produced single-line statement. */
function patternRe(pattern: string): RegExp {
  const parts = pattern.trim().split(/\s+/);
  const reBody = parts.map(reEscape).join('\\s+');
  return new RegExp(reBody, 'g');
}

/**
 * Find the first occurrence of `oldPattern` (generator-produced single-line form)
 * in the decoded block body, then replace it with `newText`.
 *
 * Handles two-line forms in the original text by joining continuation lines
 * before matching.
 *
 * Returns the modified block body, or `undefined` if the pattern was not found.
 */
function replaceFirstStatement(
  decodedBody: string,
  oldPattern: string,
  newText: string,
): string | undefined {
  const lines = splitLines(decodedBody);
  const oldRe = patternRe(oldPattern);
  let cumLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.replace(/\s+$/, '');
    const endsWithOpen = trimmed.endsWith('(') && !trimmed.includes(')');

    if (endsWithOpen && i + 1 < lines.length) {
      const joined = trimmed + ' ' + lines[i + 1]!.replace(/^\s+/, '');
      const m = oldRe.exec(joined);
      if (m) {
        const lineStart = cumLen;
        const line2Start = cumLen + line.length + 1; // +1 for the \n
        const line2End = line2Start + (lines[i + 1]?.length ?? 0);
        return decodedBody.slice(0, lineStart) + newText + decodedBody.slice(line2End);
      }
    }

    const m = oldRe.exec(line);
    if (m) {
      return decodedBody.slice(0, cumLen) + newText + decodedBody.slice(cumLen + line.length);
    }
    cumLen += line.length + 1; // +1 for LF
  }
  return undefined;
}

// ── Symbol resolution helpers ──

function mmiSym(id: number, syms: WriterSymbols): string {
  return syms.mmiById.get(id) ?? String(id);
}

function iiSym(id: number, syms: WriterSymbols): string {
  return syms.iiById.get(id) ?? String(id);
}

function srtSym(id: number, syms: WriterSymbols): string {
  return syms.srtById.get(id) ?? String(id);
}

// ── Statement generators ──

function genMenuLine(id: number, syms: WriterSymbols): string {
  return `\t\tAddMenu( ${mmiSym(id, syms)} );`;
}

function genStructureLine(id: number, syms: WriterSymbols): string {
  return `\t\tm_nStructure= ${srtSym(id, syms)};`;
}

function genDialogLine(file: string): string {
  return `\t\tm_szDialog= "${file}";`;
}

function genOutputLine(b: boolean): string {
  return `\t\tSetOutput( ${b ? 'TRUE' : 'FALSE'} );`;
}

function genSetEquipLine(equip: readonly CharacterIncEquipPart[], syms: WriterSymbols): string {
  const args = equip.map((e) => iiSym(e.itemId, syms)).join(', ');
  return `\t\tSetEquip( ${args} );`;
}

function genVendorSlotLine(tab: CharacterIncVendorTab): string {
  return `\t\tAddVendorSlot( ${tab.slot},\r\n\t${tab.label}\r\n\t);`;
}

function genVendorItemLine(v: CharacterIncVendorItem): string {
  const sym = v.itemKind3Symbol || String(v.itemKind3);
  return `\t\tAddVendorItem( ${v.slot}, ${sym}, ${v.itemJob}, ${v.uniqueMin}, ${v.uniqueMax}, ${v.totalNum} );`;
}

function genVendorItemIdLine(v: CharacterIncVendorItemId): string {
  return `\t\tAddVendorItem2( ${v.slot}, ${v.itemId} );`;
}

// ── Public API ──

/**
 * Pure: apply an edit to decoded character.inc text.
 * Throws if the target block key is absent from the text.
 *
 * @param incText - Decoded character.inc (UTF-16LE decoded to a JS string).
 * @param key     - Block key (e.g. `MaFl_Marche`). Must exist.
 * @param edit    - Fields to change; only set fields are touched.
 * @param syms    - Reverse-lookup maps for symbol emission.
 * @returns The modified decoded text.
 */
export function applyCharacterEdit(
  incText: string,
  key: string,
  edit: CharacterEdit,
  syms: WriterSymbols,
): string {
  const range = findBlockRange(incText, key);
  if (!range) throw new Error(`character.inc: block "${key}" not found`);
  const [blockStart, blockEnd] = range;
  const blockBody = incText.slice(
    incText.indexOf('{', blockStart) + 1,
    blockEnd - 1,
  );
  let body = blockBody;
  const lines = splitLines(body);
  const origLines = [...lines];

  // ── menus ──
  if (edit.menus) {
    const firstIdx = removeAllStatements(lines, 'AddMenu(');
    removeAllStatements(lines, 'AddMenuLang(');
    if (edit.menus.length > 0) {
      const newLines = edit.menus.map((id) => genMenuLine(id, syms));
      const pos = firstIdx >= 0 ? firstIdx : lines.length;
      // Use the indentation of the original first AddMenu line, if it existed.
      if (firstIdx >= 0 && origLines[firstIdx] !== undefined) {
        const indent = (origLines[firstIdx] as string).match(/^\s*/)?.[0] ?? '\t\t';
        for (let j = 0; j < newLines.length; j++) {
          newLines[j] = indent + newLines[j]!.trimStart();
        }
      }
      insertLines(lines, pos, newLines);
    }
  }

  // ── structure ──
  if (edit.structure !== undefined) {
    removeAllStatements(lines, 'm_nStructure=');
    if (edit.structure !== null) {
      insertLines(lines, lines.length, [genStructureLine(edit.structure, syms)]);
    }
  }

  // ── dialogFile ──
  if (edit.dialogFile !== undefined) {
    removeAllStatements(lines, 'm_szDialog=');
    if (edit.dialogFile !== null) {
      insertLines(lines, lines.length, [genDialogLine(edit.dialogFile)]);
    }
  }

  // ── output ──
  if (edit.output !== undefined) {
    removeAllStatements(lines, 'SetOutput(');
    insertLines(lines, lines.length, [genOutputLine(edit.output)]);
  }

  // ── vendorTabs ──
  if (edit.vendorTabs) {
    removeAllStatements(lines, 'AddVendorSlot(');
    removeAllStatements(lines, 'AddVenderSlot(');
    if (edit.vendorTabs.length > 0) {
      const newLines: string[] = [];
      for (const tab of edit.vendorTabs) {
        newLines.push(...genVendorSlotLine(tab).split('\n'));
      }
      insertLines(lines, lines.length, newLines);
    }
  }

  // ── vendorItems ──
  if (edit.vendorItems) {
    removeAllStatements(lines, 'AddVendorItem(');
    if (edit.vendorItems.length > 0) {
      const newLines = edit.vendorItems.map((v) => genVendorItemLine(v));
      insertLines(lines, lines.length, newLines);
    }
  }

  // ── vendorItemIds ──
  if (edit.vendorItemIds) {
    removeAllStatements(lines, 'AddVendorItem2(');
    if (edit.vendorItemIds.length > 0) {
      const newLines = edit.vendorItemIds.map((v) => genVendorItemIdLine(v));
      insertLines(lines, lines.length, newLines);
    }
  }

  // ── outfit ──
  if (edit.outfit !== undefined) {
    if (edit.outfit === null) {
      removeAllStatements(lines, 'SetFigure(');
      removeAllStatements(lines, 'SetEquip(');
    } else {
      rewriteOutfit(lines, edit.outfit, syms);
    }
  }

  body = joinLines(lines);

  // ── Splice modified body back into incText ──
  const bodyStart = incText.indexOf('{', blockStart) + 1;
  return incText.slice(0, bodyStart) + body + incText.slice(blockEnd - 1);
}

function rewriteOutfit(
  lines: string[],
  outfit: NonNullable<CharacterEdit['outfit']>,
  syms: WriterSymbols,
): void {
  // ── SetEquip ──
  const sortedEquip = [...outfit.equip].sort((a, b) => a.parts - b.parts);
  for (let i = 1; i < sortedEquip.length; i++) {
    if (sortedEquip[i]!.parts !== sortedEquip[i - 1]!.parts + 1) {
      throw new Error(
        `SetEquip: non-contiguous parts (gap between ${sortedEquip[i - 1]!.parts} and ${sortedEquip[i]!.parts}). ` +
        `All slots between min and max must be filled to avoid positional misalignment.`,
      );
    }
  }
  const equipParts: CharacterIncEquipPart[] = sortedEquip.map(
    (e) => ({ parts: e.parts, itemId: e.itemId }),
  );

  // Remove old SetEquip, insert new at same position (or at end if none existed).
  const oldEquipIdx = removeAllStatements(lines, 'SetEquip(');
  const newEquipLine = genSetEquipLine(equipParts, syms);
  const equipPos = oldEquipIdx >= 0 ? oldEquipIdx : lines.length;
  if (oldEquipIdx >= 0) {
    const indent = '\t\t';
    insertLines(lines, equipPos, [indent + newEquipLine.trimStart()]);
  } else {
    insertLines(lines, lines.length, [newEquipLine]);
  }

  // ── SetFigure ──
  // Find existing SetFigure to extract the MI_* model token (the loader discards it).
  const figFound = findStatement(lines, 'SetFigure(');
  let miToken = 'MI_UNKNOWN';
  if (figFound) {
    const [, matchedText] = figFound;
    const miMatch = matchedText.match(/\b(MI_[A-Z0-9_]+)\b/);
    if (miMatch) miToken = miMatch[1]!;
  } else {
    throw new Error(
      `SetFigure: no existing SetFigure found in block -- cannot determine the MI_* model token. ` +
      `The loader discards it during parse; without a prior SetFigure the model is unknown. ` +
      `Add a SetFigure line to the block manually before editing the outfit programmatically.`,
    );
  }

  removeAllStatements(lines, 'SetFigure(');
  const colorHex = `0x${outfit.hairColor.toString(16).padStart(8, '0')}`;
  const newFigLine = `\t\tSetFigure( ${miToken}, ${outfit.hairMesh}, ${colorHex}, ${outfit.headMesh} );`;
  insertLines(lines, lines.length, [newFigLine]);
}

/**
 * Pure: set an `IDS_*` token's text in decoded `character.txt.txt`.
 * Replaces the existing line when the token is found; appends at end when absent.
 * Does NOT disturb any other lines.
 */
export function setTextEntry(txtText: string, token: string, text: string): string {
  const lines = splitLines(txtText);
  const prefix = `${token}\t`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith(prefix)) {
      lines[i] = `${token}\t${text}`;
      return joinLines(lines);
    }
  }
  // Append: preserve trailing newline if present.
  lines.push(`${token}\t${text}`);
  return joinLines(lines);
}

/**
 * I/O wrapper: read both raw files, apply edit, write both back as
 * UTF-16LE + BOM. Writes are near-atomic (both buffers built before either write).
 *
 * @param rawDir - Path to the `raw/` directory.
 * @param key    - Block key (e.g. `MaFl_Marche`).
 * @param edit   - Fields to change.
 */
export async function writeCharacterEdit(
  rawDir: string,
  key: string,
  edit: CharacterEdit,
): Promise<void> {
  const incPath = resolve(rawDir, 'character.inc');
  const txtPath = resolve(rawDir, 'character.txt.txt');

  const [incBuf, txtBuf] = await Promise.all([
    readFile(incPath),
    readFile(txtPath).catch(() => Buffer.alloc(0)),
  ]);

  const incText = decode(incBuf);
  let txtText = txtBuf.length > 0 ? decode(txtBuf) : '';

  // Resolve the block's SetName token for name edits.
  const nameToken = findSetNameToken(incText, key);

  // Apply name edit to character.txt.txt.
  if (edit.name !== undefined) {
    if (!nameToken) {
      throw new Error(
        `character.inc: block "${key}" has no SetName( IDS_* ) token. ` +
        `Cannot set name without a SetName statement in the block.`,
      );
    }
    txtText = setTextEntry(txtText, nameToken, edit.name);
  }

  // Apply all inc edits.
  const syms = await loadSymbols(rawDir);
  const newIncText = applyCharacterEdit(incText, key, edit, syms);

  const incOut = encode(newIncText);
  const txtOut = txtText ? encode(txtText) : txtBuf;

  await Promise.all([
    writeFile(incPath, incOut),
    txtBuf.length > 0 ? writeFile(txtPath, txtOut) : Promise.resolve(),
  ]);
}

/** Find the `SetName( IDS_* )` token in a block, operating on decoded text. */
function findSetNameToken(text: string, key: string): string | undefined {
  const range = findBlockRange(text, key);
  if (!range) return undefined;
  const bodyStart = text.indexOf('{', range[0]) + 1;
  const body = text.slice(bodyStart, range[1] - 1);
  // Multi-line SetName form: SetName\r\n(\r\nIDS_...\r\n)
  const m = body.match(/\bSetName\s*\(\s*([A-Za-z0-9_]+)\s*\)/);
  return m?.[1];
}

// ── UTF-16LE codec ──

/** Strip UTF-16LE BOM if present, then decode. */
function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/** Encode text as UTF-16LE with a BOM prefix. */
function encode(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

// ── WriterSymbols builder ──

const SRT_MAP: Record<string, number> = {
  SRT_NONE: 0, SRT_LODESTAR: 1, SRT_LODELOGHT: 2, SRT_STATION: 3,
  SRT_WEAPON: 4, SRT_SHIELD: 5, SRT_FOOD: 6, SRT_MAGIC: 7,
  SRT_GENERAL: 8, SRT_PUBLICOFFICE: 9, SRT_QUESTOFFICE: 10,
  SRT_DUNGEON: 11, SRT_BUCKLER: 12, SRT_WARPZONE: 13,
};

/**
 * Build {@link WriterSymbols} by reading and inverting the `#define` files
 * in `rawDir`. Call once (results are immutable) and cache.
 */
export async function loadSymbols(rawDir: string): Promise<WriterSymbols> {
  const [mmiBuf, iiBuf] = await Promise.all([
    readFile(resolve(rawDir, 'defineNeuz.h')).catch(() => null),
    readFile(resolve(rawDir, 'defineItem.h')).catch(() => null),
  ]);
  const mmiForward = mmiBuf ? parseDefines(decode(mmiBuf), 'MMI_') : new Map<string, number>();
  const iiForward = iiBuf ? parseDefines(decode(iiBuf), 'II_') : new Map<string, number>();

  const mmiById = invertMap(mmiForward);
  const iiById = invertMap(iiForward);
  const srtById = new Map<number, string>();
  for (const [sym, id] of Object.entries(SRT_MAP)) srtById.set(id, sym);

  return { mmiById, iiById, srtById };
}

function parseDefines(content: string, prefix: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = new RegExp(`^\\s*#define\\s+(${prefix}\\w+)\\s+(\\d+)`, 'gm');
  for (let m = re.exec(content); m !== null; m = re.exec(content)) {
    const sym = m[1];
    const val = m[2];
    if (sym !== undefined && val !== undefined) out.set(sym, parseInt(val, 10));
  }
  return out;
}

function invertMap<K, V>(m: Map<K, V>): Map<V, K> {
  const out = new Map<V, K>();
  for (const [k, v] of m) out.set(v, k);
  return out;
}
