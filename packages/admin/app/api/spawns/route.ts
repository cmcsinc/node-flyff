/**
 * Zone monster-spawn CRUD.
 *
 * A spawn lives inside a zone YAML file, so it is addressed by the composite ref
 * `<zoneId>:<spawnId>` — `flaris:12`, or `flaris:new` to append.
 *
 * SECURITY: `auth()` first on every mutating verb. A spawn whose `mover_id` has
 * no propMover entry null-derefs the client's `OnAddObj` when `SpawnManager`
 * materializes it, so the body is validated by `SpawnSchema` inside `saveSpawn`
 * before it reaches disk.
 *
 * @module app/api/spawns/route
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { findSpawn, saveSpawn, deleteSpawn } from "@/lib/spawns";
import { parseZoneRef } from "@/lib/zone-seq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutSchema = z.object({
  ref: z.string().min(3),
  spawn: z.record(z.unknown()),
});

const DeleteSchema = z.object({ ref: z.string().min(3) });

function badRef() {
  return NextResponse.json({ ok: false, error: "Invalid spawn ref" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref) return NextResponse.json({ ok: false, error: "Missing ref" }, { status: 400 });

  const parsed = parseZoneRef(ref);
  if (!parsed || parsed.entryId === null) return badRef();

  const found = findSpawn(parsed.zoneId, parsed.entryId);
  if (!found) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, file: found.file, spawn: found.spawn });
}

/** Create (`ref` ending in `:new`) or replace one spawn point. */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = PutSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const parsed = parseZoneRef(body.data.ref);
  if (!parsed) return badRef();

  let id: number;
  try {
    id = saveSpawn(parsed.zoneId, parsed.entryId, body.data.spawn);
  } catch (e) {
    const msg = e instanceof z.ZodError
      ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  await writeAudit(session, {
    action: parsed.entryId === null ? "spawn_create" : "spawn_update",
    targetType: "zone_spawn",
    targetId: id,
    details: { zoneId: parsed.zoneId },
  });

  return NextResponse.json({ ok: true, ref: `${parsed.zoneId}:${id}` });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRef();

  const parsed = parseZoneRef(body.data.ref);
  if (!parsed || parsed.entryId === null) return badRef();

  if (!deleteSpawn(parsed.zoneId, parsed.entryId)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  await writeAudit(session, {
    action: "spawn_delete",
    targetType: "zone_spawn",
    targetId: parsed.entryId,
    details: { zoneId: parsed.zoneId },
  });

  return NextResponse.json({ ok: true });
}
