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
import {
  detectEol,
  escapeRe,
  findStatements,
  replaceStatements,
  settingEnd,
  splitLines,
} from './incStatements';

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
 *
 * Operates on the ORIGINAL text (comments intact) -- unlike `parseCharacterInc`,
 * which strips comments first -- because the writer's whole purpose is to leave
 * comments where they are. That means both hazards below have to be handled here
 * rather than inherited from the loader:
 *
 * - The header may carry a trailing comment before the brace:
 *   `Mada_Guildcombatshop // 길드대전 상인` then `{` on the next line.
 * - A `//` comment inside the body may contain a stray `{` or `}`, which would
 *   otherwise unbalance the depth scan and return the wrong range.
 *
 * Returns `[startOfKey, indexAfterOpeningBrace, positionAfterClosingBrace]`, or
 * `undefined` when the key is absent or its braces never balance. The middle
 * value is handed back rather than re-found with `indexOf('{')`, which would land
 * on a brace inside the header comment.
 */
function findBlockRange(text: string, key: string): [number, number, number] | undefined {
  // Header: key, then optional trailing `//` comment, then `{` (same or later line).
  const re = new RegExp(`^${escapeRe(key)}[ \\t]*(?://[^\\r\\n]*)?\\s*\\{`, 'gm');
  const m = re.exec(text);
  if (!m?.[0] || m.index === undefined) return undefined;
  const openIdx = m.index + m[0].length - 1;

  let depth = 1;
  let i = openIdx + 1;
  let inComment = false;
  for (; i < text.length && depth > 0; i++) {
    const c = text[i];
    if (inComment) {
      if (c === '\n') inComment = false;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { inComment = true; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  if (depth !== 0) return undefined;
  return [m.index, openIdx + 1, i];
}

/** Join lines with the EOL detected from the original text. */
function joinLinesEol(lines: string[], eol: '\r\n' | '\n'): string {
  return lines.join(eol);
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
//
// None of these carry leading indentation: `replaceStatements` re-applies the
// indentation of the statement it is replacing, so a generator that indented
// itself would double it.

function genMenuLine(id: number, syms: WriterSymbols): string {
  return `AddMenu( ${mmiSym(id, syms)} );`;
}

function genStructureLine(id: number, syms: WriterSymbols): string {
  return `m_nStructure= ${srtSym(id, syms)};`;
}

function genDialogLine(file: string): string {
  return `m_szDialog= "${file}";`;
}

function genOutputLine(b: boolean): string {
  return `SetOutput( ${b ? 'TRUE' : 'FALSE'} );`;
}

function genSetEquipLine(equip: readonly CharacterIncEquipPart[], syms: WriterSymbols): string {
  const args = equip.map((e) => iiSym(e.itemId, syms)).join(', ');
  return `SetEquip( ${args} );`;
}

/**
 * Multi-line form, matching how the raw file authors it. Split on LF by the
 * caller; only the first line gets the source indentation, the continuation
 * lines keep the raw file's own shallower indent.
 */
function genVendorSlotLine(tab: CharacterIncVendorTab): string {
  return `AddVendorSlot( ${tab.slot},\n\t${tab.label}\n\t);`;
}

function genVendorItemLine(v: CharacterIncVendorItem): string {
  const sym = v.itemKind3Symbol || String(v.itemKind3);
  return `AddVendorItem( ${v.slot}, ${sym}, ${v.itemJob}, ${v.uniqueMin}, ${v.uniqueMax}, ${v.totalNum} );`;
}

function genVendorItemIdLine(v: CharacterIncVendorItemId): string {
  return `AddVendorItem2( ${v.slot}, ${v.itemId} );`;
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
  const [, bodyStart, blockEnd] = range;
  const eol = detectEol(incText);
  const lines = splitLines(incText.slice(bodyStart, blockEnd - 1));

  // Absent statements are appended just before the `setting { }` group closes --
  // that is where the raw file keeps all of them, and appending after the group
  // would put them in the block's outer scope where the client's parser ignores
  // them.
  const at = () => settingEnd(lines);

  if (edit.menus) {
    // AddMenuLang is the localized variant; both are replaced by the plain form.
    replaceStatements(lines, 'AddMenuLang', [], at());
    replaceStatements(lines, 'AddMenu', edit.menus.map((id) => genMenuLine(id, syms)), at());
  }

  if (edit.structure !== undefined) {
    const repl = edit.structure === null ? [] : [genStructureLine(edit.structure, syms)];
    replaceStatements(lines, 'm_nStructure', repl, at());
  }

  if (edit.dialogFile !== undefined) {
    const repl = edit.dialogFile === null ? [] : [genDialogLine(edit.dialogFile)];
    replaceStatements(lines, 'm_szDialog', repl, at());
  }

  if (edit.output !== undefined) {
    replaceStatements(lines, 'SetOutput', [genOutputLine(edit.output)], at());
  }

  if (edit.vendorTabs) {
    // `AddVenderSlot` is the raw file's own misspelling; both spellings occur.
    replaceStatements(lines, 'AddVenderSlot', [], at());
    replaceStatements(
      lines,
      'AddVendorSlot',
      edit.vendorTabs.flatMap((t) => genVendorSlotLine(t).split('\n')),
      at(),
    );
  }

  if (edit.vendorItems) {
    replaceStatements(lines, 'AddVendorItem', edit.vendorItems.map(genVendorItemLine), at());
  }

  if (edit.vendorItemIds) {
    replaceStatements(lines, 'AddVendorItem2', edit.vendorItemIds.map(genVendorItemIdLine), at());
  }

  if (edit.outfit !== undefined) {
    if (edit.outfit === null) {
      replaceStatements(lines, 'SetFigure', [], at());
      replaceStatements(lines, 'SetEquip', [], at());
    } else {
      rewriteOutfit(lines, edit.outfit, syms, at);
    }
  }

  return incText.slice(0, bodyStart) + joinLinesEol(lines, eol) + incText.slice(blockEnd - 1);
}

/**
 * Rewrite `SetFigure` + `SetEquip` in place.
 *
 * `SetEquip` is positional -- the loader derives each part's slot from the
 * argument's index -- so a gap in `parts` would silently shift every later item
 * onto the wrong body slot. Rejected rather than guessed.
 *
 * `SetFigure`'s first argument is the `MI_*` model index, which the loader's
 * regex discards. It is therefore read back out of the existing statement and
 * re-emitted verbatim. A block with `SetEquip` but no `SetFigure` still reports an
 * outfit (hair/head 0); writing those zeros back is accepted as a no-op, but a
 * real hair/head value is rejected since no model token can be synthesized.
 */
function rewriteOutfit(
  lines: string[],
  outfit: NonNullable<CharacterEdit['outfit']>,
  syms: WriterSymbols,
  at: () => number,
): void {
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

  // Recover the model token BEFORE any statement is removed.
  const fig = findStatements(lines, 'SetFigure')[0];

  replaceStatements(lines, 'SetEquip', [genSetEquipLine(equipParts, syms)], at());

  if (!fig) {
    // A block can carry SetEquip with no SetFigure -- the loader still reports an
    // outfit, with hair/head defaulting to 0. Writing those zeros back is a no-op,
    // so stay silent; only a real hair/head value needs a model token we don't have.
    if (outfit.hairMesh === 0 && outfit.hairColor === 0 && outfit.headMesh === 0) return;
    throw new Error(
      `SetFigure: no existing SetFigure found in block -- cannot determine the MI_* model token. ` +
      `The loader discards it during parse; without a prior SetFigure the model is unknown. ` +
      `Add a SetFigure line to the block manually before editing the outfit programmatically.`,
    );
  }

  const miToken = /\b(MI_[A-Za-z0-9_]+)\b/.exec(fig.text)?.[1];
  if (!miToken) {
    throw new Error(
      `SetFigure: existing statement has no MI_* model token: ${fig.text.trim()}`,
    );
  }

  const colorHex = `0x${outfit.hairColor.toString(16).padStart(8, '0')}`;
  replaceStatements(
    lines,
    'SetFigure',
    [`SetFigure( ${miToken}, ${outfit.hairMesh}, ${colorHex}, ${outfit.headMesh} );`],
    at(),
  );
}

/**
 * Pure: set an `IDS_*` token's text in decoded `character.txt.txt`.
 * Replaces the existing line when the token is found; appends at end when absent.
 * Does NOT disturb any other lines.
 */
export function setTextEntry(txtText: string, token: string, text: string): string {
  const eol = detectEol(txtText);
  const lines = splitLines(txtText);
  const prefix = `${token}\t`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith(prefix)) {
      lines[i] = `${token}\t${text}`;
      return joinLinesEol(lines, eol);
    }
  }
  // Append. When the file ends with a newline, `splitLines` leaves a trailing
  // empty element -- overwrite it so the new entry lands on that blank final
  // line and the trailing newline is re-added by the join.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines[lines.length - 1] = `${token}\t${text}`;
    lines.push('');
  } else {
    lines.push(`${token}\t${text}`);
  }
  return joinLinesEol(lines, eol);
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
  const body = text.slice(range[1], range[2] - 1);
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
