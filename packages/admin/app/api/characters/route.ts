import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...fields } = body;

  if (typeof id !== "number") {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const allowed = [
    "level", "hp", "mp", "maxHp", "maxMp",
    "strength", "stamina", "dexterity", "intelligence",
    "remainGp", "skillPoint", "skillLevel",
    "x", "y", "z", "worldId", "zoneId",
  ] as const;

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (key in fields && typeof fields[key] !== "undefined") {
      updates[key] = fields[key];
    }
  }

  await db.update(characters).set(updates).where(eq(characters.id, id));

  // TODO: audit logging — requires admin_audit_log table migration

  return NextResponse.json({ ok: true });
}
