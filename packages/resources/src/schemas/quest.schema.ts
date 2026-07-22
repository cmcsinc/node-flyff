/**
 * Zod schemas for quest definitions parsed from `propQuest.inc`.
 *
 * The C++ `CProject::LoadPropQuest` (`_Common/PROJECT.CPP:1500+`) reads a
 * whitespace-heavy, brace-nested block grammar:
 *
 * ```
 * <id> { SetTitle(...); setting { <Set* commands; QuestItem(...)> }
 *        SetDialog(n, text); ...  state N { SetDesc/SetCond/SetStatus; QuestItem } }
 * ```
 *
 * Rather than mirror the ~40 `Set*` command signatures here AND in the
 * converter, the converter emits each command verbatim as `{ cmd, args }` with
 * symbols (MI_*, II_*, JOB_*, QT_*) resolved to numbers where the define
 * tables allow. The runtime condition/reward engine (Phase 3) interprets
 * commands positionally -- exactly as the C++ loader does. Unknown/unresolved
 * payloads are preserved, never dropped.
 *
 * @module schemas/quest
 */

import { z } from 'zod';

/** A single typed command argument. `sym` args resolve to a number when the
 *  symbol exists in the define tables, otherwise stay a string. */
export const QuestArgSchema = z.object({
  type: z.enum(['num', 'str', 'sym', 'bool']),
  value: z.union([z.number(), z.string()]),
});

/** One `Set*(...)` / `QuestItem(...)` call inside a quest block. */
export const QuestCommandSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(QuestArgSchema),
});

/** `QuestItem(MI_*, II_*, prob, num)` -- drives quest-item drops from a monster. */
export const QuestItemSchema = z.object({
  mover: z.number().int(),
  item: z.number().int(),
  prob: z.number().int(),
  num: z.number().int(),
});

/** A `state N { ... }` sub-block -- per-state desc/cond/status text + QuestItems. */
export const QuestStateSchema = z.object({
  desc: z.string().optional(),
  cond: z.string().optional(),
  status: z.string().optional(),
  quest_items: z.array(QuestItemSchema).optional(),
});

/** One parsed quest definition -- one file per quest under `data/quests/<id>.yml`. */
export const QuestDefSchema = z.object({
  _version: z.literal('1.0'),
  /** Numeric quest id (resolved from definequest.h `QUEST_*` or a literal). */
  id: z.number().int().nonnegative(),
  /** Original id token (e.g. `QUEST_1`, `QUEST2_HEROMIND`, or a literal number string). */
  symbol: z.string(),
  /** `SetTitle(IDS_*)` string-id -- resolved to display text at runtime via propQuest.txt.txt. */
  title: z.string().optional(),
  /** All `Set*` calls in declaration order (flattened across `setting` + top level). */
  commands: z.array(QuestCommandSchema),
  /** `state N { ... }` blocks keyed by N (0 = `QS_BEGIN` body). */
  states: z.record(z.string(), QuestStateSchema),
  /** `SetDialog(n, IDS_*)` server-only dialog text, keyed by n (0-31). */
  dialog: z.record(z.string(), z.string()).optional(),
  /** All `QuestItem(...)` calls aggregated across the block (drop generators). */
  quest_items: z.array(QuestItemSchema),
});

/** Index row -- `data/quests/_index.yml`. */
export const QuestIndexRowSchema = z.object({
  id: z.number().int().nonnegative(),
  symbol: z.string(),
  title: z.string().optional(),
});
export const QuestIndexSchema = z.object({
  _version: z.literal('1.0'),
  quests: z.array(QuestIndexRowSchema),
});

export type QuestArg = z.infer<typeof QuestArgSchema>;
export type QuestCommand = z.infer<typeof QuestCommandSchema>;
export type QuestItem = z.infer<typeof QuestItemSchema>;
export type QuestState = z.infer<typeof QuestStateSchema>;
export type QuestDef = z.infer<typeof QuestDefSchema>;
export type QuestIndex = z.infer<typeof QuestIndexSchema>;
