/**
 * Dialog resource loader.
 *
 * Loads the WorldDialog string table, the character.inc NPC->prefix map, and the
 * per-NPC dialog state files emitted by `scripts/converters/dialogs.ts`.
 *
 * @module loaders/dialog.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import {
  DialogFileSchema,
  DialogStringTableSchema,
  DialogNpcMapSchema,
  type DialogFile,
  type DialogState,
} from '../schemas/dialog.schema';

const logger = createResourceLogger('dialog.loader');

export interface DialogIndex {
  /** WorldDialog.txt strings; `strings[n]` resolves `Say(n)` / `Speak(n)`. */
  strings: string[];
  /** character.inc block key (e.g. `MaFl_Marche`) -> `szNpc` prefix. */
  npcToPrefix: Map<string, string>;
  /** szNpc prefix -> dialog file (states keyed by dialog key index). */
  byPrefix: Map<string, DialogFile>;
}

/** Resolve a string index to its display text, or `undefined` if out of range. */
export function dialogText(index: DialogIndex, n: number): string | undefined {
  return index.strings[n];
}

/**
 * Resolve the dialog prefix for a spawned NPC.
 *
 * Accepts either the character.inc block key (`MaFl_Marche`) or a MI_* stem
 * (`MI_MAFL_MARCHE`); both collapse to `mafl_marche` by case-insensitive match.
 */
export function prefixForNpc(index: DialogIndex, npcKey: string): string | undefined {
  const direct = index.npcToPrefix.get(npcKey);
  if (direct) return direct;
  const stripped = npcKey.replace(/^MI_/i, '').toLowerCase();
  return index.byPrefix.has(stripped) ? stripped : undefined;
}

/** Look up a state by prefix + dialog key index. */
export function stateForKey(
  index: DialogIndex,
  prefix: string,
  keyIdx: number,
): DialogState | undefined {
  return index.byPrefix.get(prefix)?.states[String(keyIdx)];
}

export async function loadDialogs(dataDir: string): Promise<DialogIndex> {
  const dir = resolve(dataDir, 'dialogues');
  logger.info({ dir }, 'Loading dialogs...');

  const stringsTable = DialogStringTableSchema.parse(
    parse(await readFile(resolve(dir, '_strings.yml'), 'utf-8')),
  );
  const npcMap = DialogNpcMapSchema.parse(
    parse(await readFile(resolve(dir, '_npc-map.yml'), 'utf-8')),
  );

  const npcToPrefix = new Map<string, string>();
  for (const [key, entry] of Object.entries(npcMap.npcs)) {
    npcToPrefix.set(key, entry.sz_npc);
  }

  const byPrefix = new Map<string, DialogFile>();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yml') && !f.startsWith('_'));
  let states = 0;
  for (const file of files) {
    try {
      const parsed = DialogFileSchema.parse(parse(await readFile(resolve(dir, file), 'utf-8')));
      byPrefix.set(parsed.prefix, parsed);
      states += Object.keys(parsed.states).length;
    } catch (err) {
      logger.warn({ file, err: (err as Error).message }, 'Failed to validate dialog file');
    }
  }

  logger.info({ files: byPrefix.size, states, strings: stringsTable.strings.length }, 'Dialogs loaded');
  return { strings: stringsTable.strings, npcToPrefix, byPrefix };
}
