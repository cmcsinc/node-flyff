/**
 * Quest write — `raw/propQuest.inc` + `raw/propQuest.txt.txt` + the yml.
 *
 * Unlike a dialog edit, this one is **client-facing**. `propQuest.inc` is packed
 * into `dataSub1.res` (`game/resource/resource.txt:132`) and
 * `Project.cpp:495 LoadPropQuest` has no `__WORLDSERVER` guard, so the client
 * parses its own copy: it renders the objective and reward lists from
 * `WndQuest.cpp`, and `Mover.cpp:9540-10290` re-evaluates the begin/end
 * conditions itself to decide the NPC quest icon.
 *
 * The response therefore reports `needsClientPatch` so the UI can say what is
 * still outstanding rather than implying the edit is live.
 *
 * SECURITY: `auth()` first, then Zod, then invariants the writer cannot check:
 *
 * - The quest must already exist. `applyQuestEdit` refuses to create a block, and
 *   a quest id absent from a stale client's archive crashes it at the unguarded
 *   deref in `DPClient.cpp:14687`.
 * - Commands are replaced wholesale inside the existing `setting { }` group, so a
 *   token with no parse branch in the C++ is rejected rather than written back —
 *   round-tripping garbage would preserve it forever.
 * - `state` blocks are never removed here. A character sitting in a removed state
 *   crashes a stale client at `DPClient.cpp:8540`.
 *
 * @module app/api/quest/route
 */

import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { stringify } from 'yaml';
import { writeQuestEdit, type QuestEdit } from '@flyff/resources';
import { auth } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { DATA_DIR, getResourceIndex, invalidateResourceCache } from '@/lib/resource-cache';
import { RAW_DIR } from '@/lib/character-inc';
import { needsClientPatch, questCmdSpec } from '@/lib/quest-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One command argument.
 *
 * `sym` is accepted so an unchanged symbolic arg round-trips with its original
 * token intact — the writer's symbol ladder prefers reusing the file's own token
 * over any reverse lookup, because a flat value→name map is ambiguous (value 1 is
 * claimed by hundreds of symbols).
 */
const ArgSchema = z.object({
  type: z.enum(['num', 'str', 'sym', 'bool']),
  value: z.union([z.number(), z.string().max(256)]),
});

const CommandSchema = z.object({
  cmd: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid command token'),
  args: z.array(ArgSchema).max(64),
});

const PutSchema = z.object({
  id: z.number().int().nonnegative(),
  /** Plain title text, written to `propQuest.txt.txt` under the block's own token. */
  title: z.string().max(512).optional(),
  /** Full replacement for the `setting { }` group's statement list. */
  commands: z.array(CommandSchema).max(256).optional(),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const body = PutSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const { id, title, commands } = body.data;

  if (title === undefined && commands === undefined) {
    return NextResponse.json({ ok: false, error: 'Nothing to change' }, { status: 400 });
  }

  const idx = await getResourceIndex();
  const def = idx.quests.byId.get(id);
  if (!def) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Quest ${String(id)} does not exist. This editor never creates a quest block — ` +
          `a new id crashes any client whose dataSub1.res predates it.`,
      },
      { status: 404 },
    );
  }

  // A token with no parse branch in LoadPropQuest is ignored by both the server
  // and the client. Writing one back would keep dead data alive in a file the
  // client parses, so it is rejected rather than round-tripped.
  const unknown = (commands ?? [])
    .map((c) => c.cmd)
    .filter((cmd, i, all) => all.indexOf(cmd) === i && questCmdSpec(cmd) === undefined);
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Command(s) ${unknown.join(', ')} have no parse branch in CProject::LoadPropQuest, ` +
          `so neither the server nor the client acts on them. Remove them instead of saving them.`,
      },
      { status: 400 },
    );
  }

  if (title !== undefined && def.title === undefined) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Quest ${String(id)} has no SetTitle( IDS_* ) statement, so it has no string-table ` +
          `token to write a title into.`,
      },
      { status: 400 },
    );
  }

  const edit: QuestEdit = {
    ...(title !== undefined ? { title } : {}),
    ...(commands !== undefined ? { commands } : {}),
  };

  try {
    // The block key is the file's own header token — `QUEST_CHANGEJOB1` for a
    // symbolic block, the numeric form otherwise. `symbol` carries whichever the
    // file used, so it is the only value that reliably locates the block.
    await writeQuestEdit(RAW_DIR, def.symbol, edit);
    await writeQuestYml(def, edit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Write failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  invalidateResourceCache();

  const patch = (commands ?? []).some((c) => needsClientPatch(c.cmd)) || title !== undefined;

  await writeAudit(session, {
    action: 'quest_edit',
    targetType: 'quest',
    targetId: id,
    details: {
      symbol: def.symbol,
      ...(title !== undefined ? { title } : {}),
      ...(commands !== undefined ? { commands: commands.map((c) => c.cmd) } : {}),
      needsClientPatch: patch,
    },
  });

  return NextResponse.json({ ok: true, id, needsClientPatch: patch });
}

/**
 * Rewrite `data/quests/<id>.yml` — the half the runtime actually loads.
 *
 * Emits the converter's own key order (`scripts/converters/quests.ts`) so a later
 * converter run reproduces this file rather than a reordered one.
 */
async function writeQuestYml(
  def: {
    id: number;
    symbol: string;
    commands: unknown;
    states: unknown;
    quest_items: unknown;
    title?: string;
    dialog?: unknown;
    no_remove?: boolean;
  },
  edit: QuestEdit,
): Promise<void> {
  const doc = {
    _version: '1.0',
    id: def.id,
    symbol: def.symbol,
    commands: edit.commands ?? def.commands,
    states: def.states,
    quest_items: def.quest_items,
    ...(def.dialog !== undefined ? { dialog: def.dialog } : {}),
    ...(def.no_remove !== undefined ? { no_remove: def.no_remove } : {}),
    // The token is unchanged by a title edit — only the text behind it moves.
    ...(def.title !== undefined ? { title: def.title } : {}),
  };
  await writeFile(resolve(DATA_DIR, 'quests', `${String(def.id)}.yml`), stringify(doc), 'utf-8');
}
