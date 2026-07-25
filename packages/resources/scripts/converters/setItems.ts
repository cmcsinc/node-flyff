/**
 * propItemEtc.inc -> data/set-items/set-items.yml converter.
 *
 * Source: one `SetItem <id> <IDS_*> { Elem { II_X PARTS_Y ... } Avail { DST_X adj eq ... } }`
 * block per set. `II_*` item symbols resolve to numeric ids via defineItem.h,
 * `PARTS_*` via defineNeuz.h, and `DST_*` via defineAttribute.h -- all in the
 * converter so the YAML stores plain numerics the loader validates without any
 * header dependency. Mirrors the C++ token scanner at `Project.cpp:4150-4194`.
 *
 * @module scripts/converters/setItems
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parseDefines, readSource } from './parse.js';

/** One set piece -- C++ `m_adwItemId[i]` + `m_anParts[i]` (`Project.h:753`). */
export interface SetItemElemYml {
  /** Resolved propItem id (II_* -> defineItem.h). */
  itemId: number;
  /** Equip slot index (PARTS_* -> defineNeuz.h). */
  parts: number;
}

/** One tiered bonus -- C++ `m_avail.anDstParam/anAdjParam/anEquiped`. */
export interface SetItemAvailYml {
  /** Destination `DST_*` id (defineAttribute.h). */
  dst: number;
  /** Additive adjustment. */
  adj: number;
  /** Piece count at which this bonus unlocks. */
  equipped: number;
}

/** A set definition -- port of `CSetItem` (`Project.h:747`). */
export interface SetItemYml {
  id: number;
  /** String-table id (IDS_PROPITEMETC_*) -- cosmetic, unused server-side. */
  nameId: string;
  elems: SetItemElemYml[];
  /** Sorted ascending by `equipped` (C++ SortItemAvail). */
  avails: SetItemAvailYml[];
}

/** Strip `/* block *\/` and `// line` comments (the C++ scanner skips both). */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Token-walk the `SetItem` blocks. Pure (no I/O) so it is unit-testable.
 *
 * The C++ scanner is token-based, not brace-nested (`Project.cpp:4150`): inside
 * a SetItem it reads category tokens (`Elem` / `Avail`) and within each a flat
 * token stream until `}`. Elem stream = `II_X PARTS_Y ...` (pairs). Avail
 * stream = `DST_X adj eq ...` (triples).
 *
 * Returns the sets + counts of symbols that failed to resolve (for the log).
 */
export function parseSetItems(
  content: string,
  iiIds: Map<string, number>,
  partsIds: Map<string, number>,
  dstIds: Map<string, number>,
): { sets: SetItemYml[]; droppedElem: number; droppedAvail: number } {
  const tokens = stripComments(content).split(/\s+/).filter((t) => t.length > 0);
  const sets: SetItemYml[] = [];
  let droppedElem = 0;
  let droppedAvail = 0;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'SetItem') continue;
    const id = parseInt(tokens[++i] ?? '', 10);
    const nameId = tokens[++i] ?? '';
    if (!Number.isFinite(id)) continue;
    i += 2; // consume the SetItem's opening `{`

    const elems: SetItemElemYml[] = [];
    const avails: SetItemAvailYml[] = [];

    while (i + 1 < tokens.length && tokens[i] !== '}') {
      const cat = tokens[i];
      if (tokens[i + 1] !== '{') break; // malformed -- bail out
      i += 2; // consume category + `{`
      if (cat === 'Elem') {
        while (i + 1 < tokens.length && tokens[i] !== '}') {
          const itemSym = tokens[i];
          const partsSym = tokens[i + 1];
          i += 2;
          const itemId = iiIds.get(itemSym);
          const parts = partsIds.get(partsSym);
          if (itemId === undefined || parts === undefined) { droppedElem++; continue; }
          elems.push({ itemId, parts });
        }
        i++; // consume category closing `}`
      } else if (cat === 'Avail') {
        while (i + 2 < tokens.length && tokens[i] !== '}') {
          const dstSym = tokens[i];
          const adj = parseInt(tokens[i + 1] ?? '', 10);
          const equipped = parseInt(tokens[i + 2] ?? '', 10);
          i += 3;
          const dst = dstIds.get(dstSym);
          if (dst === undefined || !Number.isFinite(adj) || !Number.isFinite(equipped)) { droppedAvail++; continue; }
          avails.push({ dst, adj, equipped });
        }
        i++; // consume category closing `}`
      } else {
        // Unknown category -- skip past its closing brace.
        while (i < tokens.length && tokens[i] !== '}') i++;
        i++;
      }
    }

    avails.sort((a, b) => a.equipped - b.equipped);
    sets.push({ id, nameId, elems, avails });
  }

  return { sets, droppedElem, droppedAvail };
}

export async function convertSetItems(rawDir: string, dataDir: string): Promise<void> {
  const [propItemEtc, defineItem, defineNeuz, defineAttr] = await Promise.all([
    readSource(resolve(rawDir, 'propItemEtc.inc')),
    readSource(resolve(rawDir, 'defineItem.h')),
    readSource(resolve(rawDir, 'defineNeuz.h')),
    readSource(resolve(rawDir, 'defineAttribute.h')),
  ]);

  const iiIds = parseDefines(defineItem, 'II_');
  const partsIds = parseDefines(defineNeuz, 'PARTS_');
  const dstIds = parseDefines(defineAttr, 'DST_');

  const { sets, droppedElem, droppedAvail } = parseSetItems(propItemEtc, iiIds, partsIds, dstIds);

  const out = resolve(dataDir, 'set-items');
  await mkdir(out, { recursive: true });
  const doc = { _version: '1.0', sets };
  await writeFile(
    resolve(out, 'set-items.yml'),
    '# Set items -- generated from propItemEtc.inc\n' + stringify(doc),
  );

  console.log(
    `  set-items: ${sets.length} sets written, ${droppedElem} elems + ${droppedAvail} avails dropped (unresolved symbols)`,
  );
}
