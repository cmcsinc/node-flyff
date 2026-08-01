/**
 * World-wide live-session actions. Currently one: kick_all (maintenance drain).
 *
 * SECURITY: this route is the ONLY authorization gate — the world executes any
 * correctly-signed `admin:command` envelope. The `auth()` check must stay first
 * and unconditional. This action disconnects EVERY online player, so it is
 * strictly more destructive than the per-character route; it requires an
 * explicit `confirm: true` in the body so a stray POST cannot drain a live
 * server.
 *
 * @module app/api/servers/kick-all/route
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { publishAdminCommand } from "@/lib/ipc";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** Must be explicitly true — guards against an accidental empty POST. */
  confirm: z.literal(true),
  /** Free-form audit label, e.g. "restart for migration 019". */
  reason: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { reason } = parsed.data;
  const delivered = await publishAdminCommand(
    reason === undefined ? { kind: "kick_all" } : { kind: "kick_all", reason },
  );
  await writeAudit(session, {
    action: "kick_all",
    targetType: "world",
    targetId: null,
    details: { delivered, ...(reason === undefined ? {} : { reason }) },
  });

  if (!delivered) {
    return NextResponse.json(
      { ok: false, error: "World server unreachable — command not delivered" },
      { status: 503 },
    );
  }

  // The drain is async on the world side; a 200 here means "accepted", not
  // "everyone is out". Per-player save results land in the world server log.
  return NextResponse.json({ ok: true });
}
