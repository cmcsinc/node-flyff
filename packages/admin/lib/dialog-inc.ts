/**
 * NPC dialog read model for the admin panel.
 *
 * An NPC's dialog is two files, not one. `raw/WorldDialog.txt` is a flat string
 * table — row `n` is the text `Say( n )` resolves — and `raw/NpcScript.cpp` holds
 * one function per dialog state (`void CNpcScript::<prefix>_<keyIdx>()`) that
 * references those rows *by number*. This module resolves the numbers back into
 * text so the panel can edit words instead of indices.
 *
 * Three facts shape the whole view:
 *
 * 1. **The client never reads dialog text.** It crosses the wire as a string
 *    (`WORLDSERVER/User.cpp:6318` writes it, `Neuz/DPClient.cpp:14354` reads it)
 *    and `WorldDialog.txt` is absent from `game/resource/resource.txt`, so it is
 *    not packed into `data.res`. A dialog edit therefore needs **no client
 *    patch** — only a world-server restart.
 * 2. **Every string index is load-bearing.** 4,244 script functions reference
 *    rows by number, so a row can be edited in place or appended past the end,
 *    never inserted or deleted. {@link DialogLineView.uses} counts how many
 *    states reference a row so the panel can warn before a shared edit.
 * 3. **`source` wins.** ~600 states carry a raw C++ body the converter could not
 *    reduce; the writer emits it verbatim and ignores the structured fields. The
 *    panel must render those read-only rather than offer controls that would be
 *    silently dropped.
 *
 * @module lib/dialog-inc
 */

import { prefixForNpc, type DialogIndex, type DialogState } from '@flyff/resources';
import { getResourceIndex } from './resource-cache';

/**
 * Rows 0-8 of `WorldDialog.txt` are not prose — they are the reserved control
 * keys the script engine routes on (`#auto` is the entry point every dialog
 * starts at). Labelled rather than shown as a bare number.
 */
export const RESERVED_KEY_LABELS: Readonly<Record<number, string>> = {
  0: '#auto — entry point',
  1: '#init',
  2: '#addKey',
  3: '#yesQuest',
  4: '#noQuest',
  5: '#questBegin',
  6: '#questBeginYes',
  7: '#questBeginNo',
  8: '#questEndComplete',
};

/** One string-table row, resolved. `index` is the `n` in `Say( n )`. */
export interface DialogLineView {
  readonly index: number;
  /** Row text, or `""` when the index is past the end of the table. */
  readonly text: string;
  /** How many states across every NPC reference this row (≥ 2 = shared). */
  readonly uses: number;
}

/** One `AddKey( label[, key[, param]] )` choice button. */
export interface DialogKeyView {
  readonly label: DialogLineView;
  /** State this choice routes to. Absent = routes to the label index itself. */
  readonly key: number | undefined;
  readonly param: number | undefined;
}

/** One dialog state — the body of `CNpcScript::<prefix>_<keyIdx>()`. */
export interface DialogStateView {
  readonly keyIdx: number;
  /** Reserved-key name for keyIdx 0-8, else `undefined`. */
  readonly reserved: string | undefined;
  readonly say: readonly DialogLineView[];
  readonly speak: readonly DialogLineView[];
  readonly keys: readonly DialogKeyView[];
  readonly exit: boolean;
  readonly timer: number | undefined;
  readonly launchQuest: boolean;
  /** `true` when the writer will emit {@link source} and ignore everything else. */
  readonly hasSource: boolean;
  /** Raw C++ body, present only when {@link hasSource}. */
  readonly source: string | undefined;
}

/** The panel's whole server-side payload for one NPC's dialog. */
export interface DialogPrefixView {
  /** `character_key` the placement carries; `""` when unset. */
  readonly characterKey: string;
  /** Resolved function-name stem (`mafl_andy`), or `undefined` when unmapped. */
  readonly prefix: string | undefined;
  /** `false` when no script group exists — nothing to edit, and no way to create one. */
  readonly exists: boolean;
  /** Row count of the string table; the index the next appended row would get. */
  readonly stringCount: number;
  readonly states: readonly DialogStateView[];
}

/**
 * How many states reference each string index, across every NPC.
 *
 * Built once per resource-index load and cached on `globalThis` (same reason as
 * `resource-cache.ts`: Next dev HMR re-evaluates modules). Keyed by the index
 * object itself so a cache invalidation naturally produces a fresh map instead
 * of a stale one.
 */
const g = globalThis as typeof globalThis & {
  __flyffDialogUses?: WeakMap<DialogIndex, Map<number, number>>;
};

function usageMap(index: DialogIndex): Map<number, number> {
  g.__flyffDialogUses ??= new WeakMap();
  const hit = g.__flyffDialogUses.get(index);
  if (hit) return hit;

  const uses = new Map<number, number>();
  const bump = (n: number): void => {
    uses.set(n, (uses.get(n) ?? 0) + 1);
  };
  for (const file of index.byPrefix.values()) {
    for (const state of Object.values(file.states)) {
      for (const n of state.say ?? []) bump(n);
      for (const n of state.speak ?? []) bump(n);
      for (const k of state.keys ?? []) bump(k.label);
    }
  }
  g.__flyffDialogUses.set(index, uses);
  return uses;
}

/** Resolve one index to text + share count. Out-of-range reads as `""`. */
function line(index: DialogIndex, uses: Map<number, number>, n: number): DialogLineView {
  return { index: n, text: index.strings[n] ?? '', uses: uses.get(n) ?? 0 };
}

function stateView(
  index: DialogIndex,
  uses: Map<number, number>,
  keyIdx: number,
  state: DialogState,
): DialogStateView {
  return {
    keyIdx,
    reserved: RESERVED_KEY_LABELS[keyIdx],
    say: (state.say ?? []).map((n) => line(index, uses, n)),
    speak: (state.speak ?? []).map((n) => line(index, uses, n)),
    keys: (state.keys ?? []).map((k) => ({
      label: line(index, uses, k.label),
      key: k.key,
      param: k.param,
    })),
    exit: state.exit ?? false,
    timer: state.timer,
    launchQuest: state.launch_quest ?? false,
    hasSource: state.source !== undefined,
    source: state.source,
  };
}

/**
 * Read one NPC's dialog, keyed by its `character_key`.
 *
 * A key with no script group returns `exists: false` rather than throwing: the
 * writer deliberately refuses to create a new group (that means inventing a
 * location among 4,244 functions plus its `// File :` header), so the panel has
 * to explain the situation instead of offering a save that would fail.
 */
export async function readDialogForKey(characterKey: string): Promise<DialogPrefixView> {
  const idx = await getResourceIndex();
  const prefix = characterKey ? prefixForNpc(idx.dialogs, characterKey) : undefined;
  return buildView(idx.dialogs, characterKey, prefix);
}

/**
 * Read one dialog script group by its own prefix (`mafl_andy`).
 *
 * The dialogues browser lists files, not placements, so it has a prefix in hand
 * and no `character_key` to map from — 0 of the 401 shipped dialogue files carry
 * one. Same view, entered from the other end.
 */
export async function readDialogForPrefix(prefix: string): Promise<DialogPrefixView> {
  const idx = await getResourceIndex();
  const characterKey = idx.dialogs.byPrefix.get(prefix)?.character_key ?? '';
  return buildView(idx.dialogs, characterKey, prefix);
}

function buildView(
  dialogs: DialogIndex,
  characterKey: string,
  prefix: string | undefined,
): DialogPrefixView {
  const file = prefix ? dialogs.byPrefix.get(prefix) : undefined;

  if (!prefix || !file) {
    return {
      characterKey,
      prefix,
      exists: false,
      stringCount: dialogs.strings.length,
      states: [],
    };
  }

  const uses = usageMap(dialogs);
  const states = Object.entries(file.states)
    .map(([k, state]) => stateView(dialogs, uses, Number(k), state))
    .filter((s) => Number.isInteger(s.keyIdx))
    .sort((a, b) => a.keyIdx - b.keyIdx);

  return {
    characterKey,
    prefix,
    exists: true,
    stringCount: dialogs.strings.length,
    states,
  };
}
