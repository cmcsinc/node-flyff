/**
 * Zone NPC placement CRUD.
 *
 * An NPC lives inside a zone YAML file, so it is addressed by the composite ref
 * `<zoneId>:<npcId>` — `flaris:12`, or `flaris:new` to append.
 *
 * SECURITY: `auth()` first on every mutating verb. A malformed placement (bad
 * `mover_id`, out-of-range angle) null-derefs the client's `OnAddObj`, so the
 * body is validated by `NpcSchema` inside `saveNpc` before it reaches disk.
 *
 * @module app/api/npcs/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { findNpc, parseNpcRef, saveNpc, deleteNpc } from '@/lib/npcs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PutSchema = z.object({
  ref: z.string().min(3),
  npc: z.record(z.unknown()),
});

const DeleteSchema = z.object({ ref: z.string().min(3) });

function badRef(): Response {
  return NextResponse.json({ ok: false, error: 'Invalid npc ref' }, { status: 400 });
}

export function GET(req: NextRequest): Response {
  const ref = req.nextUrl.searchParams.get('ref');
  if (!ref) return NextResponse.json({ ok: false, error: 'Missing ref' }, { status: 400 });

  const parsed = parseNpcRef(ref);
  if (parsed?.npcId == null) return badRef();

  const found = findNpc(parsed.zoneId, parsed.npcId);
  if (!found) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, file: found.file, npc: found.npc });
}

/** Create (`ref` ending in `:new`) or replace one NPC placement. */
export async function PUT(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const body = PutSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }

  const parsed = parseNpcRef(body.data.ref);
  if (!parsed) return badRef();

  let id: number;
  try {
    id = saveNpc(parsed.zoneId, parsed.npcId, body.data.npc);
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : e instanceof Error
          ? e.message
          : 'Save failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  await writeAudit(session, {
    action: parsed.npcId === null ? 'npc_create' : 'npc_update',
    targetType: 'zone_npc',
    targetId: id,
    details: { zoneId: parsed.zoneId },
  });

  return NextResponse.json({ ok: true, ref: `${parsed.zoneId}:${String(id)}` });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const body = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRef();

  const parsed = parseNpcRef(body.data.ref);
  if (parsed?.npcId == null) return badRef();

  if (!deleteNpc(parsed.zoneId, parsed.npcId)) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  await writeAudit(session, {
    action: 'npc_delete',
    targetType: 'zone_npc',
    targetId: parsed.npcId,
    details: { zoneId: parsed.zoneId },
  });

  return NextResponse.json({ ok: true });
}
