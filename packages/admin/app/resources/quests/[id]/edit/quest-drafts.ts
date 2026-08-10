/**
 * Draft state for the quest editor.
 *
 * Kept separate from the panel so the dirty-check and the PUT body are testable
 * without React, and so the panel does not carry two responsibilities.
 *
 * The draft mirrors `QuestDef.commands` positionally: index N in the draft is
 * index N in the file. That is deliberate — the writer addresses statements by
 * their position inside the `setting { }` group, so a draft that reordered
 * commands would rewrite statements the GM never touched.
 *
 * @module app/resources/quests/[id]/edit/quest-drafts
 */

import type { QuestArg } from '@flyff/resources';
import type { CommandView } from '@/lib/quest-args';
import type { QuestEditorView } from '@/lib/quest-editor';
import { questCmdSpec, type BlastTier } from '@/lib/quest-fields';

/** One command being edited: its token plus the current arg values. */
export interface CommandDraft {
  readonly cmd: string;
  readonly args: readonly QuestArg[];
  readonly tier: BlastTier;
  readonly dead: boolean;
  /** False once the GM deletes it; kept so indices stay stable until save. */
  readonly removed: boolean;
}

export interface QuestDraft {
  readonly title: string;
  readonly commands: readonly CommandDraft[];
}

/** Args as stored, with spec-only slots dropped — an unfilled slot is not an arg. */
function argsOf(view: CommandView): QuestArg[] {
  return view.args.flatMap((a) => (a.arg ? [a.arg] : []));
}

export function draftFromView(view: QuestEditorView): QuestDraft {
  return {
    title: view.title,
    commands: view.commands.map((c) => ({
      cmd: c.cmd,
      args: argsOf(c),
      tier: c.tier,
      dead: c.dead,
      removed: false,
    })),
  };
}

/** Replace one arg of one command, padding with zeros if the slot is past the end. */
export function setArg(
  draft: QuestDraft,
  cmdIndex: number,
  argIndex: number,
  arg: QuestArg,
): QuestDraft {
  const commands = draft.commands.map((c, i) => {
    if (i !== cmdIndex) return c;
    const args = [...c.args];
    // Filling an optional slot the file omitted (a goal-marker tail) means the
    // slots before it must exist too, or the args land in the wrong positions.
    while (args.length < argIndex) args.push({ type: 'num', value: 0 });
    args[argIndex] = arg;
    return { ...c, args };
  });
  return { ...draft, commands };
}

export function toggleRemoved(draft: QuestDraft, cmdIndex: number): QuestDraft {
  return {
    ...draft,
    commands: draft.commands.map((c, i) => (i === cmdIndex ? { ...c, removed: !c.removed } : c)),
  };
}

/** Append a command with one zero arg per fixed spec slot. */
export function addCommand(draft: QuestDraft, cmd: string): QuestDraft {
  const spec = questCmdSpec(cmd);
  const fixed = spec?.repeat ? spec.args.length - spec.repeat.size : (spec?.args.length ?? 0);
  const args: QuestArg[] = [];
  for (let i = 0; i < fixed; i++) {
    // A sentinel-bearing slot starts at its sentinel, not 0 — for a sex arg, 0
    // is "male" and -1 is "any", and a new command should not silently mean male.
    args.push({ type: 'num', value: spec?.args[i]?.sentinel ?? 0 });
  }
  return {
    ...draft,
    commands: [
      ...draft.commands,
      { cmd, args, tier: spec?.tier ?? 'structural', dead: spec === undefined, removed: false },
    ],
  };
}

function sameArgs(a: readonly QuestArg[], b: readonly QuestArg[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b.at(i);
    return x.type === y?.type && x.value === y.value;
  });
}

export function isDirty(draft: QuestDraft, baseline: QuestDraft): boolean {
  if (draft.title !== baseline.title) return true;
  if (draft.commands.length !== baseline.commands.length) return true;
  return draft.commands.some((c, i) => {
    // `.at` rather than `[i]`: this package does not enable
    // noUncheckedIndexedAccess, so `[i]` is typed as always-present and the
    // out-of-range guard would be silently dropped as dead code.
    const b = baseline.commands.at(i);
    if (b === undefined) return true;
    return c.cmd !== b.cmd || c.removed || !sameArgs(c.args, b.args);
  });
}

/** Highest tier touched by the pending edit — drives the confirm copy. */
export function pendingTier(draft: QuestDraft, baseline: QuestDraft): BlastTier | null {
  const rank: Record<BlastTier, number> = { server: 0, cosmetic: 1, structural: 2 };
  const touched: BlastTier[] = [];

  // A title edit writes propQuest.txt.txt, which the client reads for the quest
  // list — display only, so cosmetic.
  if (draft.title !== baseline.title) touched.push('cosmetic');

  draft.commands.forEach((c, i) => {
    const b = baseline.commands.at(i);
    if (b === undefined || c.removed || !sameArgs(c.args, b.args)) touched.push(c.tier);
  });
  // Commands the draft dropped entirely still count at their own tier.
  for (const b of baseline.commands.slice(draft.commands.length)) {
    touched.push(b.tier);
  }

  return touched.reduce<BlastTier | null>(
    (worst, t) => (worst === null || rank[t] > rank[worst] ? t : worst),
    null,
  );
}

/** PUT body: only the commands array when it changed, plus the title when it did. */
export function buildPutBody(
  questId: number,
  draft: QuestDraft,
  baseline: QuestDraft,
): { id: number; title?: string; commands?: { cmd: string; args: QuestArg[] }[] } {
  const commandsChanged =
    draft.commands.length !== baseline.commands.length ||
    draft.commands.some((c, i) => {
      const b = baseline.commands.at(i);
      return b === undefined || c.cmd !== b.cmd || c.removed || !sameArgs(c.args, b.args);
    });

  return {
    id: questId,
    ...(draft.title !== baseline.title ? { title: draft.title } : {}),
    ...(commandsChanged
      ? {
          commands: draft.commands
            .filter((c) => !c.removed)
            .map((c) => ({ cmd: c.cmd, args: [...c.args] })),
        }
      : {}),
  };
}
