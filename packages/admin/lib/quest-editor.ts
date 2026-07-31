/**
 * Server-side view model for the quest editor.
 *
 * Pairs each stored `{cmd, args}` from `data/quests/<id>.yml` with its signature
 * from {@link module:lib/quest-fields}, so the client renders one named, typed
 * control per argument instead of a positional row of raw numbers.
 *
 * Commands are grouped by **blast radius**, not by declaration order. That is the
 * one grouping a GM has to act on: a `server` edit needs a world-server restart,
 * a `cosmetic` or `structural` edit also needs the client archive rebuilt or
 * every un-patched client renders the quest wrong (`structural`) or shows the
 * wrong prize (`cosmetic`). See `.claude/rules/12-admin-form-ux.md` for why this
 * is a form-correctness concern and not decoration.
 *
 * @module lib/quest-editor
 */

import type { QuestDef } from "@flyff/resources";
import { getResourceIndex } from "./resource-cache";
import { pairQuestArgs, type CommandView } from "./quest-args";
import { QUEST_CMDS, questCmdSpec, type BlastTier } from "./quest-fields";

export type { ArgView, CommandView } from "./quest-args";

export interface QuestEditorView {
  readonly id: number;
  readonly symbol: string;
  /** Resolved title text, not the `IDS_*` token. */
  readonly title: string;
  readonly titleToken?: string;
  readonly commands: readonly CommandView[];
  /** Per-state desc/cond/status text, keyed by state number. */
  readonly states: Readonly<Record<string, { desc?: string; cond?: string; status?: string }>>;
  /** Server-only story text from `SetDialog`, keyed by slot. */
  readonly dialog: Readonly<Record<string, string>>;
  readonly noRemove?: boolean;
  /** Count per tier, for the header banner. */
  readonly tierCounts: Readonly<Record<BlastTier, number>>;
}

/** Resolve an `IDS_PROPQUEST_INC_*` token to its display text. */
async function resolveText(token: string | undefined): Promise<string> {
  if (!token) return "";
  const res = await getResourceIndex();
  return res.questText.get(token) ?? "";
}

/**
 * Build the editor view for one quest id.
 *
 * @returns `undefined` when no quest with that id exists.
 */
export async function loadQuestForEdit(questId: number): Promise<QuestEditorView | undefined> {
  const res = await getResourceIndex();
  const def: QuestDef | undefined = res.quests.byId.get(questId);
  if (!def) return undefined;

  const commands: CommandView[] = def.commands.map((cmd, index) => {
    const spec = questCmdSpec(cmd.cmd);
    return {
      index,
      cmd: cmd.cmd,
      args: pairQuestArgs(cmd, spec),
      ...(spec ? { spec } : {}),
      // An unrecognised token gets the strictest tier: it cannot be shown as
      // "safe to edit" when nothing here knows what reads it.
      tier: spec?.tier ?? "structural",
      dead: spec === undefined,
    };
  });

  const tierCounts: Record<BlastTier, number> = { server: 0, cosmetic: 0, structural: 0 };
  for (const c of commands) if (!c.dead) tierCounts[c.tier]++;

  const states: Record<string, { desc?: string; cond?: string; status?: string }> = {};
  for (const [n, state] of Object.entries(def.states)) {
    states[n] = {
      ...(state.desc !== undefined ? { desc: state.desc } : {}),
      ...(state.cond !== undefined ? { cond: state.cond } : {}),
      ...(state.status !== undefined ? { status: state.status } : {}),
    };
  }

  return {
    id: def.id,
    symbol: def.symbol,
    title: await resolveText(def.title),
    ...(def.title !== undefined ? { titleToken: def.title } : {}),
    commands,
    states,
    dialog: def.dialog ?? {},
    ...(def.no_remove !== undefined ? { noRemove: def.no_remove } : {}),
    tierCounts,
  };
}

/** Every command token with a signature, for the "add a command" picker. */
export function addableCommands(): { cmd: string; label: string; tier: BlastTier }[] {
  return Object.entries(QUEST_CMDS)
    .map(([cmd, spec]) => ({ cmd, label: spec.label, tier: spec.tier }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
