/**
 * Zod schemas for NPC dialog definitions.
 *
 * Migrated from the original Flyff `WorldDialog.txt` string table and the
 * compiled `NpcScript.cpp` per-NPC script bodies. Each NPC script function
 * `void CNpcScript::<prefix>_<keyIdx>()` becomes one {@link DialogState}.
 *
 * The simple subset (`Say`/`Speak`/`AddKey`/`Exit`/`SetScriptTimer`/`LaunchQuest`)
 * is parsed into structured fields. Complex bodies (conditionals, quest state,
 * item ops) are preserved verbatim in `source` for later porting — nothing is
 * dropped.
 *
 * @module schemas/dialog
 */

import { z } from 'zod';

/** A player-selectable choice button (`AddKey(label[, key[, param]])`). */
export const DialogKeySchema = z.object({
  /** Text index into the string table for the button label. */
  label: z.number().int().nonnegative(),
  /** Key index this choice routes to. Omitted → routes to the label index itself. */
  key: z.number().int().nonnegative().optional(),
  /** Integer parameter passed with the routing (`AddKey` 3-arg form). */
  param: z.number().int().optional(),
});

/** One state of an NPC dialog — the body of `CNpcScript::<prefix>_<keyIdx>()`. */
export const DialogStateSchema = z.object({
  /** `Say(n)` text indices (NPC dialog body lines). */
  say: z.array(z.number().int().nonnegative()).optional(),
  /** `Speak(NpcId(), n)` overhead/broadcast text indices. */
  speak: z.array(z.number().int().nonnegative()).optional(),
  /** `AddKey(...)` choice buttons. */
  keys: z.array(DialogKeySchema).optional(),
  /** `Exit()` — close the dialog. */
  exit: z.boolean().optional(),
  /** `SetScriptTimer(n)` auto-close seconds. */
  timer: z.number().int().positive().optional(),
  /** `LaunchQuest()` / `BeginQuest(n)` hook — state triggers a quest lifecycle op. */
  launch_quest: z.boolean().optional(),
  /**
   * Quest id to begin when this state's `LaunchQuest`/`BeginQuest(n)` fires.
   * Optional — the simple-subset converter could not extract the id from the
   * global-state-routed `LaunchQuest()` form, so most launch states leave this
   * unset until the `source` bodies are ported. `runDialog` only calls
   * `questService.beginQuest` when an id is present.
   */
  launch_quest_id: z.number().int().nonnegative().optional(),
  /**
   * Raw C++ body for states using calls/conditionals outside the simple subset
   * (GetQuestState, BeginQuest, ChangeJob, CreateItem, if/for, …). Ported later.
   */
  source: z.string().optional(),
});

/** Per-NPC dialog file — one per `szNpc` prefix (e.g. `mafl_marche`). */
export const DialogFileSchema = z.object({
  _version: z.string(),
  /** `szNpc` prefix; function-name stem shared by all states (`<prefix>_<keyIdx>`). */
  prefix: z.string().min(1),
  /** Optional character.inc block this group belongs to (e.g. `MaFl_Marche`). */
  character_key: z.string().optional(),
  /** States keyed by dialog key index (0 = `#auto` entry, 9 = `Introduction`, …). */
  states: z.record(z.string(), DialogStateSchema),
});

/** WorldDialog.txt flat string table. */
export const DialogStringTableSchema = z.object({
  _version: z.string(),
  /** Line N (1-based) of WorldDialog.txt → `strings[N-1]`. `Say(n)` resolves here. */
  strings: z.array(z.string()),
});

/** character.inc NPC → dialog-prefix map. */
export const DialogNpcMapSchema = z.object({
  _version: z.string(),
  npcs: z.record(
    z.string(),
    z.object({
      /** `m_szDialog` filename from character.inc (e.g. `MaFl_Marche.txt`). */
      dialog_file: z.string(),
      /** Lowercased stem → matches NpcScript.cpp function prefix. */
      sz_npc: z.string(),
    }),
  ),
});

export type DialogKey = z.infer<typeof DialogKeySchema>;
export type DialogState = z.infer<typeof DialogStateSchema>;
export type DialogFile = z.infer<typeof DialogFileSchema>;
export type DialogStringTable = z.infer<typeof DialogStringTableSchema>;
export type DialogNpcMap = z.infer<typeof DialogNpcMapSchema>;
