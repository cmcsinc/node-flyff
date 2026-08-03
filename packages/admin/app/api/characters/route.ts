import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { characters } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

const int = (max: number) => z.number().int().min(0).max(max);

/**
 * Editable character fields. Intentionally narrower than the `characters` table:
 * world location (world_id/zone_id/x/y/z), vitals (hp/mp/max_hp/max_mp) and
 * `skill_level` (lifetime SP earned) are NOT admin-editable — see the header
 * comment in app/characters/[id]/edit-stats.tsx for why.
 */
const PatchSchema = z.object({
  id: z.number().int().positive(),
  level: z.number().int().min(1).max(199).optional(),
  // The `exp` column is a `bigInteger` (migration 001) that drizzle declares as
  // `text()`, so an untouched row reads back as a JS number while an edited one
  // arrives as the digit string `percentToExp` produced. Coerce, then bound.
  exp: z.coerce.string().regex(/^\d{1,19}$/).optional(),
  class: int(255).optional(),
  strength: int(65_535).optional(),
  stamina: int(65_535).optional(),
  dexterity: int(65_535).optional(),
  intelligence: int(65_535).optional(),
  remainGp: int(1_000_000).optional(),
  skillPoint: int(1_000_000).optional(),
  pkPropensity: int(1_000_000).optional(),
  pkValue: int(1_000_000).optional(),
  /** Epoch ms of the last PK action (C++ `m_dwPKTime`); 0 = never. */
  pkTime: int(2_147_483_647_000).optional(),
  pkExp: int(1_000_000).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }

  const { id, ...updates } = parsed.data;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(characters)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(characters.id, id));

  // TODO: audit logging — requires admin_audit_log table migration

  return NextResponse.json({ ok: true });
}
