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
 * `MMI_DIALOG = 0` gates the right-click "Dialog" option -> SCRIPTDLG
 * (`Project.cpp:3024` does `lpCharacter->m_abMoverMenu[ nMMI ] = TRUE`).
 * `MAX_MOVER_MENU = 175` (`defineNeuz.h:314`).
 *
 * Linkage: character.inc block keys (`MaFl_Marche`) align with propMover
 * `MI_*` keys via strip + lowercase -- same collapse as
 * `dialog.loader.ts:prefixForNpc`.
 *
 * @module loaders/characterInc
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResourceLogger } from '../logger';

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
  MMI_NPC_BUFF: 74,
};

/** SRT_* structure type defines (defineNeuz.h:75-89). Resolves `m_nStructure=`. */
const SRT_MAP: Record<string, number> = {
  SRT_NONE: 0, SRT_LODESTAR: 1, SRT_LODELOGHT: 2, SRT_STATION: 3,
  SRT_WEAPON: 4, SRT_SHIELD: 5, SRT_FOOD: 6, SRT_MAGIC: 7,
  SRT_GENERAL: 8, SRT_PUBLICOFFICE: 9, SRT_QUESTOFFICE: 10,
  SRT_DUNGEON: 11, SRT_BUCKLER: 12, SRT_WARPZONE: 13,
};

/** `MMI_DIALOG` (`defineNeuz.h:92`) -- gates the right-click Dialog option. */
export const MMI_DIALOG = 0;
export const MMI_BANKING = 9;

/** `MMI_TRADE` (`defineNeuz.h:94`) -- gates the right-click Shop option -> OPENSHOPWND. */
export const MMI_TRADE = 2;

/**
 * `MMI_NPC_BUFF` (`defineNeuz.h:180`) -- gates the right-click Buff Pang option
 * under `__NPC_BUFF`. The client sends `PACKETTYPE_NPC_BUFF` with the NPC's
 * character.inc key; the server applies the block's `SetBuffSkill` list.
 */
export const MMI_NPC_BUFF = 74;

/**
 * `MMI_GUILDBANKING` (`defineNeuz.h:105`) -- gates the right-click Guild Bank
 * option, and more importantly the server-side proximity gate: every guild-bank
 * opcode re-checks `IsCloseNpc( MMI_GUILDBANKING, ... )`
 * (`DPSrvr.cpp:3590`, `:3682`), not just the window open, so a client that
 * keeps the window open and walks away cannot keep transacting.
 */
export const MMI_GUILDBANKING = 15;

/** One equipped part -- C++ `m_adwEquip[ nEquipNum++ ]` (Project.cpp:2937). */
export interface CharacterIncEquipPart {
  /** Slot index (PARTS_* from defineNeuz.h:26-35) -- derived from equip order. */
  readonly parts: number;
  /** Resolved propItem id (II_* -> defineItem.h). */
  readonly itemId: number;
}

/**
 * One shop tab -- C++ `AddVendorSlot( nSlot, IDS_* )` -> `m_venderSlot[nSlot]`
 * (Project.cpp:3047-3053). The label is a client string-table id (resolved from
 * the client's own resources); the server stores the raw token verbatim.
 */
export interface CharacterIncVendorTab {
  readonly slot: number;
  /** Raw label token (e.g. `IDS_CHARACTER_INC_000022`). Client resolves text. */
  readonly label: string;
}

/**
 * One category-based shop entry -- C++ `AddVendorItem` -> `VENDOR_ITEM` pushed to
 * `m_venderItemAry[nSlot]` (Project.cpp:3095-3112). The server expands the
 * category + sex/level range into concrete propItem ids when a future shop-open
 * handler needs the stock list.
 */
export interface CharacterIncVendorItem {
  readonly slot: number;
  /** `m_nItemkind3` -- IK3_* (defineItemkind.h) resolved to its number. */
  readonly itemKind3: number;
  /**
   * Original IK3_* symbol verbatim from `AddVendorItem` (e.g. `IK3_SWD`). The
   * shop stock resolver matches this against `ItemIndex.byKind3` (symbol key) so
   * no second `defineItemkind.h` parse is needed and symbol/number drift is
   * impossible. Empty string when the token was a bare numeric literal.
   */
  readonly itemKind3Symbol: string;
  /** `m_nItemJob` -- sex/job filter (raw arg 3; -1 = any). */
  readonly itemJob: number;
  /** `m_nUniqueMin` -- min item level/grade bound. */
  readonly uniqueMin: number;
  /** `m_nUniqueMax` -- max item level/grade bound. */
  readonly uniqueMax: number;
  /** `m_nTotalNum` -- stock count / density. */
  readonly totalNum: number;
}

/**
 * One explicit-id shop entry -- C++ `AddVendorItem2( nSlot, dwId )` ->
 * `m_venderItemAry2[nSlot]` (Project.cpp:3114-3123). `dwId` is a concrete
 * propItem id (II_* value), no category expansion needed.
 */
export interface CharacterIncVendorItemId {
  readonly slot: number;
  readonly itemId: number;
}

/** Outfit fields -- C++ `SetFigure` (Project.cpp:2959) + `SetEquip` (:2928). */
export interface CharacterIncOutfit {
  readonly characterKey: string;
  /** `m_dwHairMesh` (u_char) -- SetFigure arg 2. */
  readonly hairMesh: number;
  /** `m_dwHairColor` (DWORD) -- SetFigure arg 3 (ARGB). */
  readonly hairColor: number;
  /** `m_dwHeadMesh` (u_char) -- SetFigure arg 4. */
  readonly headMesh: number;
  readonly equip: readonly CharacterIncEquipPart[];
}

/** Parsed character.inc block -- one per `MaFl_*` / `MaDa_*` / ... header. */
export interface CharacterIncBlock {
  readonly key: string;
  /**
   * `SetName( IDS_* )` string-table token -- C++ `Project.cpp:3023` does
   * `lpCharacter->m_strName = GetLangScript(script)`, and `CMover::InitCharacter`
   * (`Mover.cpp:1011`) copies it into `m_szName`. This is the authoritative NPC
   * display name source; propMover's name is the shared *model* name and is wrong
   * for NPCs (e.g. `MaFl_SsoTta` rides model `MI_MADA_BOLPOR`).
   * Resolve via `CharacterTextIndex`.
   */
  readonly nameId: string | undefined;
  /** `SetImage( IDS_* )` token -- resolves to a portrait `.tga` filename. */
  readonly imageId: string | undefined;
  /** MMI_* ids from AddMenu/AddMenuLang, deduped + ascending. */
  readonly menus: readonly number[];
  /** `true` when `AddMenu( MMI_DIALOG )` fired. */
  readonly hasDialog: boolean;
  /** Outfit from SetFigure/SetEquip -- `undefined` when neither is present. */
  readonly outfit: CharacterIncOutfit | undefined;
  /** `m_szDialog` filename (e.g. `MaFl_Marche.txt`). */
  readonly dialogFile: string | undefined;
  /** Shop tabs from `AddVendorSlot` (label is a client string-table id). */
  readonly vendorTabs: readonly CharacterIncVendorTab[];
  /** Category stock from `AddVendorItem` (IK3_* + sex/level range). */
  readonly vendorItems: readonly CharacterIncVendorItem[];
  /** Explicit-id stock from `AddVendorItem2` (concrete propItem ids). */
  readonly vendorItemIds: readonly CharacterIncVendorItemId[];
  /** `m_nVenderType` from `SetVenderType` (`undefined` when not set). */
  readonly venderType: number | undefined;
  /** Count of `AddVendorSlot(...)` entries (`vendorTabs.length`). */
  readonly vendorSlotCount: number;
  /**
   * Buff-pang skill list from `SetBuffSkill` under `__NPC_BUFF`
   * (`Project.cpp:3218-3231`). Empty for non-buff NPCs. Each entry is applied to
   * the player when they right-click a buff NPC + send `PACKETTYPE_NPC_BUFF`.
   */
  readonly buffSkills: readonly NpcBuffSkillEntry[];
  /** `m_nStructure` value (SRT_* define). `undefined` when not set (default -1). */
  readonly structure: number | undefined;
  /**
   * `bOutput` from `SetOutput( TRUE|FALSE )` (`Project.cpp:2975` default TRUE,
   * `:3256` sets FALSE). `CWorld::IsUsableDYO2` (`WorldFile.cpp:1181`) drops
   * every `.dyo` placement whose character block has this FALSE, so retail
   * never renders them. 177 of 397 Flaris blocks are FALSE -- unported, they
   * all spawn and visually stack on the live NPCs.
   */
  readonly output: boolean;
  /**
   * `LANG_*` tokens from `SetLang(...)` (`Project.cpp:3248`). C++ flips the
   * `bOutput` verdict when the running client's language is NOT in this list.
   * Kept for fidelity; see the gate in `spawn.manager.ts` for why it currently
   * has no effect.
   */
  readonly langs: readonly string[];
}

/**
 * One `SetBuffSkill( skillId, level, minLV, maxLV, timeMs )` entry -- C++
 * `NPC_BUFF_SKILL` (`Project.h:384-393`). The server applies `skillId` at
 * `level` to a player whose level is in `[minPlayerLevel, maxPlayerLevel]`,
 * overriding the skill's base duration with `durationMs`.
 */
export interface NpcBuffSkillEntry {
  readonly skillId: number;
  readonly level: number;
  readonly minPlayerLevel: number;
  readonly maxPlayerLevel: number;
  readonly durationMs: number;
}

export interface CharacterIncIndex {
  /** Block key (e.g. `MaFl_Marche`) -> block. Case-sensitive exact match. */
  readonly byKey: Map<string, CharacterIncBlock>;
  /** Lowercased stem (e.g. `mafl_marche`) -> block. */
  readonly byStem: Map<string, CharacterIncBlock>;
  /** `IDS_CHARACTER_INC_* -> text` from `raw/character.txt.txt`. Resolves
   *  `SetName` / `SetImage` tokens. Empty when the file is absent. */
  readonly text: Map<string, string>;
}

/**
 * Resolve an NPC's display name for a character.inc block key.
 *
 * Follows the C++ chain: block -> `SetName(IDS_*)` -> `character.txt.txt` text
 * (`Project.cpp:3023` + `Mover.cpp:1011`). Returns `undefined` when the block is
 * unknown, has no `SetName`, or the token is missing from the string table --
 * callers fall back to the raw charKey rather than showing a wrong model name.
 */
export function npcNameForKey(
  idx: CharacterIncIndex,
  charKey: string | undefined,
): string | undefined {
  if (!charKey) return undefined;
  const block = idx.byKey.get(charKey) ?? idx.byStem.get(charKey.toLowerCase());
  if (!block?.nameId) return undefined;
  return idx.text.get(block.nameId);
}

/**
 * Resolve a character.inc block for a propMover `MI_*` key.
 *
 * Strips `MI_`, lowercases, and looks up the stem -- so `MI_MAFL_MARCHE` finds
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
 * because the C++ scanner walks tokens regardless of nesting -- `setting {...}`
 * is not a separate scope for token recognition (Project.cpp:2928-3069).
 */
function parseBlock(
  key: string,
  body: string,
  iiIds: Map<string, number>,
  ik3Ids: Map<string, number>,
  mmiIds: Map<string, number>,
  siIds: Map<string, number>,
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

  // `SetName( IDS_* )` / `SetImage( IDS_* )` -- the token may sit on its own line
  // (character.inc formats these multi-line), hence the `\s*` around the arg.
  const nameId = body.match(/\bSetName\s*\(\s*([A-Za-z0-9_]+)\s*\)/)?.[1];
  const imageId = body.match(/\bSetImage\s*\(\s*([A-Za-z0-9_]+)\s*\)/)?.[1];

  const vendorTabs = parseVendorTabs(body);
  const vendorItems = parseVendorItems(body, ik3Ids);
  const vendorItemIds = parseVendorItemIds(body);
  const buffSkills = parseBuffSkills(body, siIds);
  const vt = body.match(/\bSetVend[oe]rType\s*\(\s*(-?\d+)\s*\)/);
  const venderType = vt?.[1] !== undefined ? parseInt(vt[1], 10) : undefined;
  const sr = body.match(/\bm_nStructure\s*=\s*(\d+|SRT_\w+)/);
  let structure: number | undefined;
  if (sr?.[1] !== undefined) {
    if (/^\d+$/.test(sr[1])) structure = parseInt(sr[1], 10);
    else structure = SRT_MAP[sr[1]] ?? undefined;
  }

  // `SetOutput( TRUE|FALSE )` -- default TRUE (Project.cpp:2975); only the
  // literal FALSE flips it (`:3256` compares the uppercased token).
  const so = body.match(/\bSetOutput\s*\(\s*([A-Za-z]+)\s*\)/);
  const output = so?.[1] === undefined ? true : so[1].toUpperCase() !== 'FALSE';
  const langs = [...body.matchAll(/\bSetLang\s*\(\s*(LANG_[A-Z]+)\s*\)/g)]
    .map((m) => m[1])
    .filter((l): l is string => l !== undefined);

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
  return {
    key,
    nameId,
    imageId,
    menus: menuArr,
    hasDialog: menus.has(MMI_DIALOG),
    outfit,
    dialogFile,
    vendorTabs,
    vendorItems,
    vendorItemIds,
    venderType,
    vendorSlotCount: vendorTabs.length,
    buffSkills,
    structure,
    output,
    langs,
  };
}

/**
 * `AddVendorSlot( nSlot, IDS_* )` -> `m_venderSlot[nSlot]` (Project.cpp:3047).
 * Accepts the C++ `AddVenderSlot` misspelling too. The label token is captured
 * verbatim -- it's a client string-table id the server never resolves.
 */
function parseVendorTabs(body: string): CharacterIncVendorTab[] {
  const re = /\bAddVend[oe]rSlot\s*\(\s*(\d+)\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  const out: CharacterIncVendorTab[] = [];
  for (const m of body.matchAll(re)) {
    const slot = m[1];
    const label = m[2];
    if (slot !== undefined && label !== undefined) out.push({ slot: parseInt(slot, 10), label });
  }
  return out;
}

/**
 * `AddVendorItem( nSlot, IK3_*, nJob, nUniqueMin, nUniqueMax, nTotalNum )` ->
 * `m_venderItemAry[nSlot]` (Project.cpp:3095). IK3_* resolved via
 * `defineItemkind.h`; a bare numeric literal is accepted too. `AddVendorItem2`
 * is excluded by the trailing `\b\s*\)` boundary (the `2` has no word boundary
 * before the paren-less form).
 */
function parseVendorItems(body: string, ik3Ids: Map<string, number>): CharacterIncVendorItem[] {
  const re = /\bAddVend[oe]rItem\s*\(\s*(\d+)\s*,\s*([A-Za-z0-9_]+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;
  const out: CharacterIncVendorItem[] = [];
  for (const m of body.matchAll(re)) {
    const [, slotRaw, kindTok, jobRaw, minRaw, maxRaw, numRaw] = m;
    if (slotRaw === undefined || kindTok === undefined || jobRaw === undefined ||
        minRaw === undefined || maxRaw === undefined || numRaw === undefined) continue;
    const itemKind3 = ik3Ids.get(kindTok) ?? (/^\d+$/.test(kindTok) ? parseInt(kindTok, 10) : -1);
    out.push({
      slot: parseInt(slotRaw, 10),
      itemKind3,
      itemKind3Symbol: /^IK3_/.test(kindTok) ? kindTok : '',
      itemJob: parseInt(jobRaw, 10),
      uniqueMin: parseInt(minRaw, 10),
      uniqueMax: parseInt(maxRaw, 10),
      totalNum: parseInt(numRaw, 10),
    });
  }
  return out;
}

/**
 * `AddVendorItem2( nSlot, dwId )` -> `m_venderItemAry2[nSlot]`
 * (Project.cpp:3114). `dwId` is a concrete propItem id. Distinct from
 * `AddVendorItem` by the explicit `2` before the paren.
 */
function parseVendorItemIds(body: string): CharacterIncVendorItemId[] {
  const re = /\bAddVend[oe]rItem2\s*\(\s*(\d+)\s*,\s*(-?\d+)\s*\)/g;
  const out: CharacterIncVendorItemId[] = [];
  for (const m of body.matchAll(re)) {
    const slot = m[1];
    const itemId = m[2];
    if (slot !== undefined && itemId !== undefined) out.push({ slot: parseInt(slot, 10), itemId: parseInt(itemId, 10) });
  }
  return out;
}

function parseHex(s: string): number {
  return s.startsWith('0x') || s.startsWith('0X')
    ? parseInt(s, 16) >>> 0
    : parseInt(s, 10) >>> 0;
}

/**
 * `SetBuffSkill( SI_*, dwSkillLV, nMinPlayerLV, nMaxPlayerLV, dwSkillTime )` ->
 * `m_vecNPCBuffSkill` (`Project.cpp:3218-3231`). `SI_*` resolved via
 * `defineSkill.h`; a bare numeric literal is accepted too (rare). Drops entries
 * whose skill id fails to resolve -- mirrors C++ silently skipping a bad row.
 */
function parseBuffSkills(body: string, siIds: Map<string, number>): NpcBuffSkillEntry[] {
  const re = /\bSetBuffSkill\s*\(\s*([A-Za-z0-9_]+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;
  const out: NpcBuffSkillEntry[] = [];
  for (const m of body.matchAll(re)) {
    const skillTok = m[1];
    const levelRaw = m[2];
    const minRaw = m[3];
    const maxRaw = m[4];
    const timeRaw = m[5];
    if (skillTok === undefined || levelRaw === undefined || minRaw === undefined ||
        maxRaw === undefined || timeRaw === undefined) continue;
    const skillId = siIds.get(skillTok) ?? (/^\d+$/.test(skillTok) ? parseInt(skillTok, 10) : -1);
    if (skillId < 0) continue;
    out.push({
      skillId,
      level: parseInt(levelRaw, 10),
      minPlayerLevel: parseInt(minRaw, 10),
      maxPlayerLevel: parseInt(maxRaw, 10),
      durationMs: parseInt(timeRaw, 10),
    });
  }
  return out;
}

/** Pure parser -- exported for tests. */
export function parseCharacterInc(
  content: string,
  iiIds: Map<string, number>,
  ik3Ids: Map<string, number>,
  mmiIds: Map<string, number>,
  siIds: Map<string, number> = new Map(),
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
    blocks.push(parseBlock(key, body, iiIds, ik3Ids, mmiIds, siIds));
    headerRe.lastIndex = i;
  }
  return blocks;
}

/**
 * Parse a tab-separated `IDS_* \t text` string table (`character.txt.txt`).
 * Same shape as `propQuest.txt.txt` -- UTF-16LE with BOM, one entry per line.
 */
function parseTextTable(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const key = line.slice(0, tab).trim();
    if (!key) continue;
    out.set(key, line.slice(tab + 1).trim());
  }
  return out;
}

/**
 * Load + index `rawDir/character.inc`. Reads `defineItem.h` (II_*),
 * `defineNeuz.h` (MMI_*), and `character.txt.txt` (NPC display names) alongside
 * so symbolic names resolve. Missing files -> empty index (servers still boot,
 * outfits + names disabled).
 */
export async function loadCharacterInc(rawDir: string): Promise<CharacterIncIndex> {
  const incPath = resolve(rawDir, 'character.inc');
  let buf: Buffer;
  try {
    buf = await readFile(incPath);
  } catch {
    logger.warn({ incPath }, 'character.inc not found -- NPC outfits/menus disabled');
    return { byKey: new Map(), byStem: new Map(), text: new Map() };
  }

  const [iiBuf, ik3Buf, mmiBuf, siBuf, txtBuf] = await Promise.all([
    readFile(resolve(rawDir, 'defineItem.h')).catch(() => null),
    readFile(resolve(rawDir, 'defineItemkind.h')).catch(() => null),
    readFile(resolve(rawDir, 'defineNeuz.h')).catch(() => null),
    readFile(resolve(rawDir, 'defineSkill.h')).catch(() => null),
    readFile(resolve(rawDir, 'character.txt.txt')).catch(() => null),
  ]);
  const iiIds = iiBuf ? parseDefines(decode(iiBuf), 'II_') : new Map<string, number>();
  const ik3Ids = ik3Buf ? parseDefines(decode(ik3Buf), 'IK3_') : new Map<string, number>();
  const mmiIds = mmiBuf ? parseDefines(decode(mmiBuf), 'MMI_') : new Map<string, number>();
  const siIds = siBuf ? parseDefines(decode(siBuf), 'SI_') : new Map<string, number>();
  const text = txtBuf ? parseTextTable(decode(txtBuf)) : new Map<string, string>();
  if (!txtBuf) logger.warn('character.txt.txt not found -- NPC display names unresolved');

  const blocks = parseCharacterInc(decode(buf), iiIds, ik3Ids, mmiIds, siIds);
  const byKey = new Map<string, CharacterIncBlock>();
  const byStem = new Map<string, CharacterIncBlock>();
  for (const b of blocks) {
    byKey.set(b.key, b);
    byStem.set(b.key.toLowerCase(), b);
  }
  logger.info(
    {
      blocks: blocks.length,
      dialog: blocks.filter((b) => b.hasDialog).length,
      named: blocks.filter((b) => b.nameId !== undefined).length,
      ii: iiIds.size, ik3: ik3Ids.size, mmi: mmiIds.size, text: text.size,
    },
    'character.inc loaded',
  );
  return { byKey, byStem, text };
}
