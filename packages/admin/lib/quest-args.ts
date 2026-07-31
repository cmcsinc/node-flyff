/**
 * Pure arg/spec pairing for quest commands — no I/O, safe in a client bundle.
 *
 * Split out of `lib/quest-editor.ts` deliberately: that module reads the resource
 * index through `node:fs`, so a `"use client"` component importing from it pulls
 * the filesystem into the browser bundle. The editor panel needs this pairing to
 * label a command the GM just added, so it lives where both halves can import it.
 *
 * @module lib/quest-args
 */

import type { QuestArg, QuestCommand } from "@flyff/resources";
import type { BlastTier, QuestArgSpec, QuestCmdSpec } from "./quest-fields";

/** One argument, paired with the spec slot it fills. */
export interface ArgView {
  /** The stored arg, or `undefined` for a spec slot the file omits. */
  readonly arg?: QuestArg;
  /** Spec slot, or `undefined` for an arg beyond the signature's length. */
  readonly spec?: QuestArgSpec;
  /** Index of the repeating group this arg belongs to, when variadic. */
  readonly group?: number;
}

/** One command in the block, resolved against its signature. */
export interface CommandView {
  /** Position in `QuestDef.commands` — the edit's address. */
  readonly index: number;
  readonly cmd: string;
  readonly args: readonly ArgView[];
  readonly spec?: QuestCmdSpec;
  /** `structural` for an unknown command — safer to over-warn. */
  readonly tier: BlastTier;
  /**
   * True when no parse branch in `LoadPropQuest` matches this token, so neither
   * server nor client acts on it. Rendered read-only.
   */
  readonly dead: boolean;
}

/**
 * Expand a command's arg list against its signature.
 *
 * A variadic tail repeats `repeat.size` slots until the args run out, so
 * `SetBeginCondJob(0,1,2)` maps all three onto the single `job` slot rather than
 * leaving two unnamed.
 */
export function pairQuestArgs(cmd: QuestCommand, spec: QuestCmdSpec | undefined): ArgView[] {
  if (!spec) return cmd.args.map((arg) => ({ arg }));

  const out: ArgView[] = [];
  const fixed = spec.repeat ? spec.args.length - spec.repeat.size : spec.args.length;

  for (let i = 0; i < cmd.args.length; i++) {
    const arg = cmd.args[i];
    if (i < fixed) {
      out.push({ arg, spec: spec.args[i] });
      continue;
    }
    if (!spec.repeat) {
      // Beyond a fixed signature: keep it, unnamed. The file is authoritative, so
      // an extra arg is shown rather than silently dropped on save.
      out.push({ arg });
      continue;
    }
    const offset = (i - fixed) % spec.repeat.size;
    out.push({
      arg,
      spec: spec.args[fixed + offset],
      group: Math.floor((i - fixed) / spec.repeat.size),
    });
  }

  // Spec slots the file omits (an optional goal tail) get an empty control so they
  // can be filled in, but only for a fixed signature — a variadic list has no
  // fixed length to pad to.
  if (!spec.repeat) {
    for (let i = cmd.args.length; i < spec.args.length; i++) {
      out.push({ spec: spec.args[i] });
    }
  }
  return out;
}
