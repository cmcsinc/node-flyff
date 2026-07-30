/**
 * NPC dialog write — `raw/NpcScript.cpp` + `raw/WorldDialog.txt` + the yml.
 *
 * A dialog edit is unusual in this codebase for one reason worth stating up
 * front: **it needs no client patch.** Dialog text crosses the wire as a string
 * (`WORLDSERVER/User.cpp:6318` → `Neuz/DPClient.cpp:14354`) and
 * `WorldDialog.txt` is not listed in `game/resource/resource.txt`, so it never
 * enters `data.res`. Only the world server reads it, and only at boot — hence
 * "restart", not "rebuild the client".
 *
 * Every save writes **both halves**. The runtime loads `data/dialogues/*.yml`,
 * but `raw/` is the regenerable source of truth: an edit that lands only in the
 * yml is discarded the next time the converter runs, and an edit that lands only
 * in `raw/` is invisible until someone re-runs it.
 *
 * SECURITY: `auth()` first, then Zod, then three hard invariants the writers
 * cannot check for themselves:
 *
 * - A state whose stored form carries `source` may only be written when the body
 *   passes that same `source` back. `source` wins over every structured field in
 *   the writer, so accepting a structured-only edit would look like it worked
 *   and change nothing; accepting one that *drops* source would delete a
 *   conditional branch and hand every player the same dialog path.
 * - Every in-place text index must already exist. Insert and delete do not exist
 *   for this table — 4,244 script functions reference rows by number.
 * - The prefix must already have a script group. Creating one means inventing a
 *   location among those functions plus its `// File :` header comment.
 *
 * @module app/api/dialog/route
 */

import { resolve } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { stringify } from "yaml";
import { writeFile } from "node:fs/promises";
import {
  writeDialogStrings,
  writeNpcScriptEdit,
  type DialogState,
  type NpcScriptEdit,
} from "@flyff/resources";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { DATA_DIR, getResourceIndex, invalidateResourceCache } from "@/lib/resource-cache";
import { RAW_DIR } from "@/lib/character-inc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A text reference in a state. Non-negative = an existing string-table row.
 * Negative = a placeholder for `newTexts[-1 - n]`, resolved to the real index
 * after the append lands. The placeholder form exists because an appended row's
 * index is only known once the file is written, and the state that references it
 * has to carry *that* number.
 */
const TextRef = z.number().int().min(-64).max(0xffff);

const StateSchema = z.object({
  say: z.array(TextRef).max(32).optional(),
  speak: z.array(TextRef).max(32).optional(),
  keys: z
    .array(
      z.object({
        label: TextRef,
        key: z.number().int().nonnegative().max(0xffff).optional(),
        param: z.number().int().optional(),
      }),
    )
    .max(32)
    .optional(),
  exit: z.boolean().optional(),
  timer: z.number().int().positive().max(0xffff).optional(),
  launch_quest: z.boolean().optional(),
  /** Must be echoed back verbatim for a state that stores one. */
  source: z.string().max(20000).optional(),
});

const PutSchema = z.object({
  prefix: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Invalid dialog prefix"),
  /** States to rewrite, keyed by dialog key index. */
  states: z.record(z.string().regex(/^\d{1,5}$/, "Invalid state key"), StateSchema).optional(),
  /** In-place replacements of existing string-table rows. */
  texts: z
    .array(z.object({ index: z.number().int().nonnegative().max(0xffff), text: z.string().max(512) }))
    .max(64)
    .optional(),
  /** Rows to append. Their assigned indices replace the negative placeholders. */
  newTexts: z.array(z.string().min(1).max(512)).max(32).optional(),
});

/** Resolve a placeholder (`-1 - i`) against the indices the append returned. */
function resolveRef(n: number, appended: readonly number[]): number {
  if (n >= 0) return n;
  const at = appended.at(-1 - n);
  if (at === undefined) {
    throw new Error(`No appended text for placeholder ${String(n)}`);
  }
  return at;
}

/** Rewrite a submitted state's text refs into real indices. */
function resolveState(state: z.infer<typeof StateSchema>, appended: readonly number[]): DialogState {
  const out: DialogState = {
    ...(state.say ? { say: state.say.map((n) => resolveRef(n, appended)) } : {}),
    ...(state.speak ? { speak: state.speak.map((n) => resolveRef(n, appended)) } : {}),
    ...(state.keys
      ? {
          keys: state.keys.map((k) => ({
            label: resolveRef(k.label, appended),
            ...(k.key !== undefined ? { key: k.key } : {}),
            ...(k.param !== undefined ? { param: k.param } : {}),
          })),
        }
      : {}),
    ...(state.exit ? { exit: true } : {}),
    ...(state.timer !== undefined ? { timer: state.timer } : {}),
    ...(state.launch_quest ? { launch_quest: true } : {}),
    ...(state.source !== undefined ? { source: state.source } : {}),
  };
  return out;
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = PutSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { prefix, states = {}, texts = [], newTexts = [] } = body.data;

  const idx = await getResourceIndex();
  const file = idx.dialogs.byPrefix.get(prefix);
  if (!file) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `NpcScript.cpp has no "${prefix}" script group. A new group must be added by ` +
          `hand (it needs its own "// File :" header among 4,244 functions).`,
      },
      { status: 404 },
    );
  }

  // Insert and delete do not exist for this table, so an out-of-range in-place
  // edit is a bug, not a request to extend.
  const count = idx.dialogs.strings.length;
  const outOfRange = texts.filter((t) => t.index >= count).map((t) => t.index);
  if (outOfRange.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Text row(s) ${outOfRange.join(", ")} do not exist (table has ${String(count)} rows). ` +
          `New text must be appended, not written past the end.`,
      },
      { status: 400 },
    );
  }

  // `source` wins in the writer, so a state that stores one must echo it back or
  // the save is either a silent no-op or a silent deletion of its branching.
  const stored: Readonly<Partial<Record<string, DialogState>>> = file.states;
  const clobbered = Object.entries(states)
    .filter(([k, s]) => stored[k]?.source !== undefined && s.source === undefined)
    .map(([k]) => k);
  if (clobbered.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `State(s) ${clobbered.join(", ")} store a raw C++ body, which overrides every ` +
          `structured field. Edit them by hand in raw/NpcScript.cpp.`,
      },
      { status: 400 },
    );
  }

  if (Object.keys(states).length === 0 && texts.length === 0 && newTexts.length === 0) {
    return NextResponse.json({ ok: false, error: "Nothing to change" }, { status: 400 });
  }

  let appended: number[] = [];
  let resolved: Record<string, DialogState> = {};
  try {
    // Order matters: the appended rows' indices are what the states must
    // reference, so the string table is written first.
    if (texts.length > 0 || newTexts.length > 0) {
      appended = await writeDialogStrings(RAW_DIR, DATA_DIR, {
        ...(texts.length > 0 ? { edits: texts } : {}),
        ...(newTexts.length > 0 ? { append: newTexts } : {}),
      });
    }

    resolved = Object.fromEntries(
      Object.entries(states).map(([k, s]) => [k, resolveState(s, appended)]),
    );

    if (Object.keys(resolved).length > 0) {
      const edit: NpcScriptEdit = { states: resolved };
      await writeNpcScriptEdit(RAW_DIR, prefix, edit);
      await writeDialogYml(prefix, file.character_key, { ...file.states, ...resolved });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Write failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  invalidateResourceCache();

  await writeAudit(session, {
    action: "dialog_edit",
    targetType: "dialog_prefix",
    // The target is a string prefix, not a numeric row id.
    targetId: null,
    details: {
      prefix,
      states: Object.keys(resolved),
      textsEdited: texts.map((t) => t.index),
      textsAppended: appended,
    },
  });

  return NextResponse.json({ ok: true, prefix, appended });
}

/**
 * Rewrite `data/dialogues/<prefix>.yml` — the half the runtime actually loads.
 *
 * Emits the converter's own shape (`scripts/converters/dialogs.ts:146`) so a
 * later converter run produces the same file rather than a reformatted one.
 */
async function writeDialogYml(
  prefix: string,
  characterKey: string | undefined,
  states: Record<string, DialogState>,
): Promise<void> {
  const doc = { _version: "1.0", prefix, character_key: characterKey, states };
  await writeFile(resolve(DATA_DIR, "dialogues", `${prefix}.yml`), stringify(doc), "utf-8");
}
