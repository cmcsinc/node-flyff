/**
 * Client-side draft model for the dialog editor.
 *
 * The panel edits **text**, not indices: a GM should type words, and the index
 * bookkeeping — which row to replace in place, which to append and what number
 * it comes back with — belongs here rather than in a control.
 *
 * A line whose `index` is `null` is new and will be appended, getting a fresh
 * string-table row. A line with an index is replaced in place. Nothing is ever
 * inserted or deleted, because 4,244 script functions reference rows by number.
 *
 * @module app/resources/npcs/[ref]/edit/dialog-drafts
 */

import type { DialogPrefixView, DialogStateView } from "@/lib/dialog-inc";

/** One editable dialog line. `null` index = a row that does not exist yet. */
export interface LineDraft {
  /** String-table row, or `null` for a line to append on save. */
  index: number | null;
  text: string;
  /** Text as loaded, so a dirty check compares content and not identity. */
  original: string;
  /** How many states reference this row — ≥ 2 means an edit is shared. */
  uses: number;
}

/** One editable `AddKey` choice. */
export interface KeyDraft {
  label: LineDraft;
  /** State this choice routes to; `null` = route to the label index itself. */
  key: number | null;
  param: number | null;
}

/** One editable dialog state. */
export interface StateDraft {
  keyIdx: number;
  say: LineDraft[];
  speak: LineDraft[];
  keys: KeyDraft[];
  exit: boolean;
  timer: number | null;
  launchQuest: boolean;
  /** `true` when the stored body is raw C++ and structured edits are ignored. */
  hasSource: boolean;
}

/** Body of `PUT /api/dialog`. Text refs may be negative placeholders. */
export interface DialogPutBody {
  prefix: string;
  states?: Record<string, {
    say?: number[];
    speak?: number[];
    keys?: { label: number; key?: number; param?: number }[];
    exit?: boolean;
    timer?: number;
    launch_quest?: boolean;
    source?: string;
  }>;
  texts?: { index: number; text: string }[];
  newTexts?: string[];
}

function lineDraft(view: { index: number; text: string; uses: number }): LineDraft {
  return { index: view.index, text: view.text, original: view.text, uses: view.uses };
}

/** A blank line the GM has just added — appended on save. */
export function blankLine(): LineDraft {
  return { index: null, text: "", original: "", uses: 0 };
}

function stateDraft(s: DialogStateView): StateDraft {
  return {
    keyIdx: s.keyIdx,
    say: s.say.map(lineDraft),
    speak: s.speak.map(lineDraft),
    keys: s.keys.map((k) => ({
      label: lineDraft(k.label),
      key: k.key ?? null,
      param: k.param ?? null,
    })),
    exit: s.exit,
    timer: s.timer ?? null,
    launchQuest: s.launchQuest,
    hasSource: s.hasSource,
  };
}

/** Build the editable draft list from the server view, in keyIdx order. */
export function draftsFromView(view: DialogPrefixView): StateDraft[] {
  return view.states.map(stateDraft);
}

/**
 * Serialize the changed states into a PUT body.
 *
 * New lines are collected into `newTexts` and referenced from the states as
 * `-1 - i` placeholders; the route swaps in the real indices once the append has
 * landed, because an appended row's number is only known after the write.
 *
 * States carrying `source` are excluded entirely: the writer would emit the raw
 * body and ignore whatever was sent, so sending it would be a no-op at best.
 */
export function buildPutBody(
  prefix: string,
  drafts: readonly StateDraft[],
  baseline: readonly StateDraft[],
): DialogPutBody {
  const newTexts: string[] = [];
  const texts = new Map<number, string>();

  /** Register a line's text and return the ref the state should carry. */
  const ref = (l: LineDraft): number => {
    if (l.index === null) {
      newTexts.push(l.text);
      return -newTexts.length; // -1 for the first, -2 for the second, …
    }
    if (l.text !== l.original) texts.set(l.index, l.text);
    return l.index;
  };

  const states: NonNullable<DialogPutBody["states"]> = {};
  for (const d of drafts) {
    if (d.hasSource) continue;
    const before = baseline.find((b) => b.keyIdx === d.keyIdx);
    if (before && !stateChanged(d, before)) continue;
    states[String(d.keyIdx)] = {
      ...(d.say.length > 0 ? { say: d.say.map(ref) } : {}),
      ...(d.speak.length > 0 ? { speak: d.speak.map(ref) } : {}),
      ...(d.keys.length > 0
        ? {
            keys: d.keys.map((k) => ({
              label: ref(k.label),
              ...(k.key !== null ? { key: k.key } : {}),
              ...(k.param !== null ? { param: k.param } : {}),
            })),
          }
        : {}),
      ...(d.exit ? { exit: true } : {}),
      ...(d.timer !== null ? { timer: d.timer } : {}),
      ...(d.launchQuest ? { launch_quest: true } : {}),
    };
  }

  // A text-only edit still has to reach the string table, so collect refs for
  // every unchanged state's lines too — without emitting the state itself.
  for (const d of drafts) {
    if (d.hasSource || Object.hasOwn(states, String(d.keyIdx))) continue;
    for (const l of [...d.say, ...d.speak, ...d.keys.map((k) => k.label)]) {
      if (l.index !== null && l.text !== l.original) texts.set(l.index, l.text);
    }
  }

  return {
    prefix,
    ...(Object.keys(states).length > 0 ? { states } : {}),
    ...(texts.size > 0
      ? { texts: [...texts].map(([index, text]) => ({ index, text })) }
      : {}),
    ...(newTexts.length > 0 ? { newTexts } : {}),
  };
}

/** Structural change to a state — a text-only edit does not count. */
function stateChanged(a: StateDraft, b: StateDraft): boolean {
  if (a.exit !== b.exit || a.timer !== b.timer || a.launchQuest !== b.launchQuest) return true;
  if (a.say.length !== b.say.length || a.speak.length !== b.speak.length) return true;
  if (a.keys.length !== b.keys.length) return true;
  if (a.say.some((l) => l.index === null) || a.speak.some((l) => l.index === null)) return true;
  return a.keys.some(
    (k, i) =>
      k.label.index === null ||
      k.label.index !== b.keys[i]?.label.index ||
      k.key !== b.keys[i]?.key ||
      k.param !== b.keys[i]?.param,
  );
}

/** Any pending change at all — structural or text-only. */
export function isDirty(drafts: readonly StateDraft[], baseline: readonly StateDraft[]): boolean {
  const body = buildPutBody("x", drafts, baseline);
  return body.states !== undefined || body.texts !== undefined || body.newTexts !== undefined;
}

/** Count of lines that will be appended as new string-table rows. */
export function appendCount(drafts: readonly StateDraft[]): number {
  return drafts.reduce(
    (n, d) =>
      n +
      d.say.filter((l) => l.index === null).length +
      d.speak.filter((l) => l.index === null).length +
      d.keys.filter((k) => k.label.index === null).length,
    0,
  );
}
