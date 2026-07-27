import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inventory, inventoryItems } from "@/../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { characterId } = await params;
  const charId = Number(characterId);
  const body = await req.json();

  if (typeof body.gold === "number") {
    await db
      .insert(inventory)
      .values({ characterId: charId, gold: String(body.gold), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: inventory.characterId,
        set: { gold: String(body.gold), updatedAt: new Date().toISOString() },
      });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "No valid fields" }, { status: 400 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { characterId } = await params;
  const charId = Number(characterId);
  const { slot } = await req.json();

  if (typeof slot !== "number") {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }

  await db
    .delete(inventoryItems)
    .where(and(eq(inventoryItems.characterId, charId), eq(inventoryItems.slot, slot)));

  return NextResponse.json({ ok: true });
}
