/**
 * `propGuildQuest.inc` loader -- guild (Wormon) quest props.
 *
 * Faithful port of `CProject::LoadPropGuildQuest`
 * (`game/source/_Common/Project.cpp:1200-1285`): brace-delimited
 * `<QUEST_SYMBOL> { ... }` blocks, order-independent keyword dispatch, and the
 * y-swapped rect that `CGuildQuestProcessor::AddQuestRect`
 * (`guildquest.cpp:270`) builds from `Region`.
 *
 * @module loaders/guildQuest
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createResourceLogger } from '../logger';

const logger = createResourceLogger('guildQuest.loader');

/** `GUILDQUESTPROP` (`_Common/guildquest.h:13-38`). */
export interface GuildQuestProp {
  /** Numeric quest id -- the `QUEST_*` symbol resolved through defines.
   *  Also the index: C++ stores props in a `CFixedArray` indexed BY quest id
   *  (`Project.cpp:1280`, `SetAtGrow(nQuestId, &prop)`). */
  readonly id: number;
  /** The `QUEST_*` symbol as written, kept for logs/admin. */
  readonly key: string;
  /** `szTitle` -- parsed and NEVER read by any C++ code path. */
  readonly title: string;
  /** `nLevel` -- likewise never read; the real level gate is a literal in the
   *  dialog script (`NpcScript.cpp:1977`). */
  readonly level: number;
  /** `dwWorldId` -- the `WI_WORLD_*` symbol resolved. */
  readonly worldId: number;
  /** `dwWormon` -- the boss's `MI_*` model index. */
  readonly wormonId: number;
  /** `vPos` -- the boss spawn point. Single fixed position, not randomized. */
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  /** `Region = x1, y1, x2, y2` AS WRITTEN in the file (Left, Top, Right, Bottom
   *  per its own comment), i.e. y1 > y2. Kept raw because the consumers
   *  y-swap it themselves -- see {@link GuildQuestProp.rect}. */
  readonly region: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  /**
   * The rect after the y-swap C++ applies at EVERY construction site:
   * `rect.SetRect( x1, y2, x2, y1 )` (`guildquest.cpp:270` in `AddQuestRect`,
   * and again at `:46`, `:66`, `:92`, `:135`, plus
   * `CProject::IsGuildQuestRegion`, `Project.cpp:4635`). Because the file's own
   * `y1` is the LARGER value, the swap is what makes `top < bottom` and the
   * rect non-empty -- it is correct, not a bug, and is applied consistently.
   * `PtInRect` then tests `x` and `z` (`guildquest.cpp:276`).
   */
  readonly rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** `szDesc[MAX_GUILD_QUEST_STATE][260]`, keyed by state number. Parsed and
   *  never read by any C++ code path. */
  readonly desc: ReadonlyMap<number, string>;
}

/** Guild-quest props indexed both ways. */
export interface GuildQuestIndex {
  readonly byId: ReadonlyMap<number, GuildQuestProp>;
  readonly byKey: ReadonlyMap<string, GuildQuestProp>;
}

/** Strip UTF-16LE BOM if present, then decode. */
function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/**
 * Strip `//`-to-end-of-line comments, but never inside a double-quoted string
 * (`Title`/`desc` values are quoted Korean text). The C++ scanner skips
 * comments at the token level, so a `//` inside a literal is data, not a
 * comment.
 */
function stripComments(content: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < content.length; i++) {
    const c = content.charAt(i);
    if (inStr) {
      out += c;
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && content[i + 1] === '/') {
      while (i < content.length && content[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/** Resolve a `SYMBOL` or literal number through the defines table. 0 on miss. */
function resolveSymbol(token: string, symbols: Map<string, number>, key: string, field: string): number {
  if (/^-?\d+$/.test(token)) return parseInt(token, 10);
  const val = symbols.get(token);
  if (val === undefined) {
    logger.warn({ key, field, token }, 'guild quest symbol unresolved -- using 0');
    return 0;
  }
  return val;
}

const TITLE_RE = /\bTitle\s*=\s*"([^"]*)"/;
const LEVEL_RE = /\bLevel\s*=\s*(-?\d+)/;
const WORLD_RE = /\bWorld\s*=\s*([A-Za-z_]\w*|-?\d+)/;
const WORMON_RE = /\bWormon\s*=\s*([A-Za-z_]\w*|-?\d+)/;
const REGION_RE = /\bRegion\s*=\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/;
const POSITION_RE = /\bPosition\s*=\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/;
const STATE_RE = /\bState\s+(\d+)\s*\{([^{}]*)\}/g;
const DESC_RE = /\bdesc\s*=\s*"([^"]*)"/;

/** Parse one comment-stripped `<QUEST_*> { ... }` body. */
function parseBlock(key: string, id: number, body: string, symbols: Map<string, number>): GuildQuestProp {
  const level = LEVEL_RE.exec(body)?.[1];
  const world = WORLD_RE.exec(body)?.[1];
  const wormon = WORMON_RE.exec(body)?.[1];
  const reg = REGION_RE.exec(body);
  const p = POSITION_RE.exec(body);

  const region = {
    x1: reg?.[1] !== undefined ? parseInt(reg[1], 10) : 0,
    y1: reg?.[2] !== undefined ? parseInt(reg[2], 10) : 0,
    x2: reg?.[3] !== undefined ? parseInt(reg[3], 10) : 0,
    y2: reg?.[4] !== undefined ? parseInt(reg[4], 10) : 0,
  };

  const desc = new Map<number, string>();
  STATE_RE.lastIndex = 0;
  for (let m = STATE_RE.exec(body); m !== null; m = STATE_RE.exec(body)) {
    const state = m[1];
    const inner = m[2];
    if (state === undefined || inner === undefined) continue;
    desc.set(parseInt(state, 10), DESC_RE.exec(inner)?.[1] ?? '');
  }

  return {
    id,
    key,
    title: TITLE_RE.exec(body)?.[1] ?? '',
    level: level !== undefined ? parseInt(level, 10) : 0,
    worldId: world !== undefined ? resolveSymbol(world, symbols, key, 'World') : 0,
    wormonId: wormon !== undefined ? resolveSymbol(wormon, symbols, key, 'Wormon') : 0,
    pos: {
      x: p?.[1] !== undefined ? parseFloat(p[1]) : 0,
      y: p?.[2] !== undefined ? parseFloat(p[2]) : 0,
      z: p?.[3] !== undefined ? parseFloat(p[3]) : 0,
    },
    region,
    // `rect.SetRect( x1, y2, x2, y1 )` -- guildquest.cpp:270.
    rect: { left: region.x1, top: region.y2, right: region.x2, bottom: region.y1 },
    desc,
  };
}

/** Pure parser -- exported for tests. */
export function parseGuildQuestInc(content: string, symbols: Map<string, number>): GuildQuestProp[] {
  const props: GuildQuestProp[] = [];
  const src = stripComments(content);
  // Top-level header: identifier at column 0 followed by `{` (possibly on the
  // next line). `State 0 {` is indented + numeric, so it never matches here.
  const headerRe = /^([A-Za-z_]\w*)\s*\{/gm;
  for (let m = headerRe.exec(src); m !== null; m = headerRe.exec(src)) {
    const key = m[1];
    if (key === undefined) continue;
    const openIdx = src.indexOf('{', m.index + m[0].length - 1);
    let depth = 1;
    let i = openIdx + 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    headerRe.lastIndex = i;
    const body = src.slice(openIdx + 1, depth === 0 ? i - 1 : i);

    const id = symbols.get(key);
    if (id === undefined) {
      logger.warn({ key }, 'guild quest id symbol unresolved -- block skipped');
      continue;
    }
    try {
      props.push(parseBlock(key, id, body, symbols));
    } catch (err) {
      logger.warn({ key, err: (err as Error).message }, 'guild quest block malformed -- skipped');
    }
  }
  return props;
}

/**
 * Load + index `rawDir/propGuildQuest.inc`. Missing file -> empty index
 * (servers still boot, guild quests simply unavailable).
 */
export async function loadGuildQuest(rawDir: string, symbols: Map<string, number>): Promise<GuildQuestIndex> {
  const incPath = resolve(rawDir, 'propGuildQuest.inc');
  let buf: Buffer;
  try {
    buf = await readFile(incPath);
  } catch {
    logger.warn({ incPath }, 'propGuildQuest.inc not found -- guild quests disabled');
    return { byId: new Map(), byKey: new Map() };
  }

  const props = parseGuildQuestInc(decode(buf), symbols);
  const byId = new Map<number, GuildQuestProp>();
  const byKey = new Map<string, GuildQuestProp>();
  for (const p of props) {
    byId.set(p.id, p);
    byKey.set(p.key, p);
  }
  logger.info({ quests: props.length }, 'propGuildQuest.inc loaded');
  return { byId, byKey };
}
