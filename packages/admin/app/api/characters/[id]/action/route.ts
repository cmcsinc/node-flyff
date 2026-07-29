/**
 * Character live-session actions: kick, teleport-to-town.
 *
 * SECURITY: this route is the ONLY authorization gate for these commands — the
 * world executes any correctly-signed `admin:command` envelope. The `auth()`
 * check must stay first and unconditional.
 *
 * @module app/api/characters/[id]/action/route
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { publishAdminCommand, type AdminCommand } from "@/lib/ipc";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  action: z.enum(["kick", "teleport_town"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const charId = Number(id);
  if (!Number.isInteger(charId) || charId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid character id" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { action } = parsed.data;
  // Teleport with no coords = the zone's revival point ("town"), resolved by the
  // world (AdminListener treats both x/z omitted as the town case).
  const cmd: AdminCommand =
    action === "kick" ? { kind: "kick", charId } : { kind: "teleport", charId };

  const delivered = await publishAdminCommand(cmd);
  await writeAudit(session, {
    action,
    targetType: "character",
    targetId: charId,
    details: { delivered },
  });

  if (!delivered) {
    return NextResponse.json(
      { ok: false, error: "World server unreachable — command not delivered" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
