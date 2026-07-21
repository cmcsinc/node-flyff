/**
 * character.inc loader.
 *
 * Parses the original Flyff `character.inc` (UTF-16LE) into a per-NPC index of
 * `m_abMoverMenu` (MMI_* ids from AddMenu/AddMenuLang), outfit (SetFigure +
 * SetEquip, with `II_*` resolved to propItem ids via `defineItem.h`), dialog
 * file (`m_szDialog`), and vendor slot count. Mirrors the C++ scanner at
 * `_Common/Project.cpp:2928-3069`.
 *
 * **MMI enum source**: `game/resource/defineNeuz.h:92-314`. Critical value
 * `MMI_DIALOG = 0` gates the right-click "Dialog" option → SCRIPTDLG
 * (`Project.cpp:3024` does `lpCharacter->m_abMoverMenu[ nMMI ] = TRUE`).
 * `MAX_MOVER_MENU = 175` (`defineNeuz.h:314`).
 *
 * Linkage: character.inc block keys (`MaFl_Marche`) align with propMover
 * `MI_*` keys via strip + lowercase — same collapse as
 * `dialog.loader.ts:prefixForNpc`.
 *
 * @module loaders/characterInc
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResourceLogger } from '../logger.js';

const logger = createResourceLogger('characterInc.loader');

/**
 * Critical MMI_* ids the loader reasons about even when `defineNeuz.h` is
 * absent. Source: `game/resource/defineNeuz.h:92-99`.
 */
const MMI_FALLBACK: Record<string, number> = {
  MMI_DIALOG: 0,
  MMI_QUEST: 1,
  MMI_TRADE: 2,
  MMI_FIGHT: 3,
  MMI_MESSAGE: 4,
  MMI_ADD_MESSENGER: 5,
  MMI_INVITE_PARTY: 6,
  MMI_INVITE_COMPANY: 7,
  MMI_MARKING: 8,
  MMI_BANKING: 9,
  MMI_GUILDBANKING: 15,
};

/** `MMI_DIALOG` (`defineNeuz.h:92`) — gates the right-click Dialog option. */
export const MMI_DIALOG = 0;

/** One equipped part — C++ `m_adwEquip[ nEquipNum++ ]` (Project.cpp:2937). */
export interface CharacterIncEquipPart {
  /** Slot index (PARTS_* from defineNeuz.h:26-35) — derived from equip order. */
  readonly parts: number;
  /** Resolved propItem id (II_* → defineItem.h). */
  readonly itemId: number;
}

/** Outfit fields — C++ `SetFigure` (Project.cpp:2959) + `SetEquip` (:2928). */
export interface CharacterIncOutfit {
  readonly characterKey: string;
  /** `m_dwHairMesh` (u_char) — SetFigure arg 2. */
  readonly hairMesh: number;
  /** `m_dwHairColor` (DWORD) — SetFigure arg 3 (ARGB). */
  readonly hairColor: number;
  /** `m_dwHeadMesh` (u_char) — SetFigure arg 4. */
  readonly headMesh: number;
  readonly equip: readonly CharacterIncEquipPart[];
}

/** Parsed character.inc block — one per `MaFl_*` / `MaDa_*` / … header. */
export interface CharacterIncBlock {
  readonly key: string;
  /** MMI_* ids from AddMenu/AddMenuLang, deduped + ascending. */
  readonly menus: readonly number[];
  /** `true` when `AddMenu( MMI_DIALOG )` fired. */
  readonly hasDialog: boolean;
  /** Outfit from SetFigure/SetEquip — `undefined` when neither is present. */
  readonly outfit: CharacterIncOutfit | undefined;
  /** `m_szDialog` filename (e.g. `MaFl_Marche.txt`). */
  readonly dialogFile: string | undefined;
  /** Count of `AddVendorSlot(...)` entries. */
  readonly vendorSlotCount: number;
}

export interface CharacterIncIndex {
  /** Block key (e.g. `MaFl_Marche`) → block. Case-sensitive exact match. */
  readonly byKey: Map<string, CharacterIncBlock>;
  /** Lowercased stem (e.g. `mafl_marche`) → block. */
  readonly byStem: Map<string, CharacterIncBlock>;
}

/**
 * Resolve a character.inc block for a propMover `MI_*` key.
 *
 * Strips `MI_`, lowercases, and looks up the stem — so `MI_MAFL_MARCHE` finds
 * the `MaFl_Marche` block. Returns `undefined` for monsters / unmatched.
 */
export function blockForMover(
  idx: CharacterIncIndex,
  miKey: string | undefined,
): CharacterIncBlock | undefined {
  if (!miKey) return undefined;
  return idx.byStem.get(miKey.replace(/^MI_/i, '').toLowerCase());
}

/** Parse `#define SYM value` lines for one prefix (e.g. `II_`, `MMI_`). */
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

/** Strip UTF-16LE BOM if present, then decode. */
function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/** Strip `//`-to-end-of-line comments (the C++ scanner skips them). */
function stripComments(content: string): string {
  return content.replace(/\/\/[^\n]*/g, '');
}

/**
 * Parse a single outer `<Key> { ... }` body. Token-scanned (not brace-nested)
 * because the C++ scanner walks tokens regardless of nesting — `setting {…}`
 * is not a separate scope for token recognition (Project.cpp:2928-3069).
 */
function parseBlock(
  key: string,
  body: string,
  iiIds: Map<string, number>,
  mmiIds: Map<string, number>,
): CharacterIncBlock {
  const menus = new Set<number>();
  for (const m of body.matchAll(/\bAddMenu(?:Lang)?\s*\([^)]*?MMI_([A-Z0-9_]+)/g)) {
    const suffix = m[1];
    if (!suffix) continue;
    const sym = `MMI_${suffix}`;
    const id = mmiIds.get(sym) ?? MMI_FALLBACK[sym];
    if (id !== undefined) menus.add(id);
  }

  const dlg = body.match(/m_szDialog\s*=\s*"([^"]+)"/);
  const dialogFile = dlg?.[1];

  const vendorSlotCount = body.split(/\bAddVendorSlot\b/).length - 1;

  const fig = body.match(
    /SetFigure\s*\(\s*MI_[A-Z0-9_]+\s*,\s*(\d+)\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(\d+)\s*\)/,
  );
  const eq = body.match(/SetEquip\s*\(\s*([^)]+)\)/);

  let outfit: CharacterIncOutfit | undefined;
  if (fig || eq) {
    const hairMesh = fig?.[1] ? parseInt(fig[1], 10) : 0;
    const hairColor = fig?.[2] ? parseHex(fig[2]) : 0;
    const headMesh = fig?.[3] ? parseInt(fig[3], 10) : 0;
    const equip: CharacterIncEquipPart[] = [];
    const equipBody = eq?.[1];
    if (equipBody) {
      const tokens = equipBody.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === undefined) continue;
        const id = iiIds.get(token);
        if (id !== undefined) equip.push({ parts: i, itemId: id });
      }
    }
    outfit = { characterKey: key, hairMesh, hairColor, headMesh, equip };
  }

  const menuArr = [...menus].sort((a, b) => a - b);
  return { key, menus: menuArr, hasDialog: menus.has(MMI_DIALOG), outfit, dialogFile, vendorSlotCount };
}

function parseHex(s: string): number {
  return s.startsWith('0x') || s.startsWith('0X')
    ? parseInt(s, 16) >>> 0
    : parseInt(s, 10) >>> 0;
}

/** Pure parser — exported for tests. */
export function parseCharacterInc(
  content: string,
  iiIds: Map<string, number>,
  mmiIds: Map<string, number>,
): CharacterIncBlock[] {
  const blocks: CharacterIncBlock[] = [];
  const src = stripComments(content);
  // Top-level header: `^Identifier\s*{` with `\s` greedy across the newline.
  const headerRe = /^([A-Z][A-Za-z0-9_]*)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(src)) !== null) {
    const key = m[1];
    if (!key) continue;
    const openIdx = src.indexOf('{', m.index + m[0].length - 1);
    let depth = 1;
    let i = openIdx + 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    const body = src.slice(openIdx + 1, i - 1);
    blocks.push(parseBlock(key, body, iiIds, mmiIds));
    headerRe.lastIndex = i;
  }
  return blocks;
}

/**
 * Load + index `rawDir/character.inc`. Reads `defineItem.h` (II_*) and
 * `defineNeuz.h` (MMI_*) alongside so symbolic names resolve to numbers.
 * Missing files → empty index (servers still boot, outfits disabled).
 */
export async function loadCharacterInc(rawDir: string): Promise<CharacterIncIndex> {
  const incPath = resolve(rawDir, 'character.inc');
  let buf: Buffer;
  try {
    buf = await readFile(incPath);
  } catch {
    logger.warn({ incPath }, 'character.inc not found — NPC outfits/menus disabled');
    return { byKey: new Map(), byStem: new Map() };
  }

  const [iiBuf, mmiBuf] = await Promise.all([
    readFile(resolve(rawDir, 'defineItem.h')).catch(() => null),
    readFile(resolve(rawDir, 'defineNeuz.h')).catch(() => null),
  ]);
  const iiIds = iiBuf ? parseDefines(decode(iiBuf), 'II_') : new Map<string, number>();
  const mmiIds = mmiBuf ? parseDefines(decode(mmiBuf), 'MMI_') : new Map<string, number>();

  const blocks = parseCharacterInc(decode(buf), iiIds, mmiIds);
  const byKey = new Map<string, CharacterIncBlock>();
  const byStem = new Map<string, CharacterIncBlock>();
  for (const b of blocks) {
    byKey.set(b.key, b);
    byStem.set(b.key.toLowerCase(), b);
  }
  logger.info(
    { blocks: blocks.length, dialog: blocks.filter((b) => b.hasDialog).length, ii: iiIds.size, mmi: mmiIds.size },
    'character.inc loaded',
  );
  return { byKey, byStem };
}
