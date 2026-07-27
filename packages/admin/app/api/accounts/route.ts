import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, banned, gm, email, banned_until } = body;

  if (typeof id !== "number") {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof banned === "boolean") updates.banned = banned;
  if (typeof gm === "boolean") updates.gm = gm;
  if (typeof email === "string") updates.email = email;
  if (typeof banned_until === "string" || banned_until === null) updates.banned_until = banned_until;

  await db.update(accounts).set(updates).where(eq(accounts.id, id));
  return NextResponse.json({ ok: true });
}
