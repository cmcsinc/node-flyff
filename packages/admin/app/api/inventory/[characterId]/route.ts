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

  const now = new Date().toISOString();

  if (typeof body.gold === "number") {
    await db
      .insert(inventory)
      .values({ characterId: charId, gold: String(body.gold), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: inventory.characterId,
        set: { gold: String(body.gold), updatedAt: now },
      });
    return NextResponse.json({ ok: true });
  }

  // Add item: { action: "add", itemId, quantity?, slot? }
  if (body.action === "add" && typeof body.itemId === "number") {
    const qty = typeof body.quantity === "number" && body.quantity > 0 ? body.quantity : 1;
    // Find next free slot if not specified
    let slot = body.slot;
    if (typeof slot !== "number") {
      const existing = await db.select({ slot: inventoryItems.slot })
        .from(inventoryItems).where(eq(inventoryItems.characterId, charId));
      const used = new Set(existing.map(r => r.slot));
      slot = 0;
      while (used.has(slot)) slot++;
    }
    await db.insert(inventoryItems).values({
      characterId: charId, slot, itemId: body.itemId, quantity: qty, createdAt: now, updatedAt: now,
    });
    return NextResponse.json({ ok: true, slot });
  }

  // Update quantity: { action: "update", id, quantity }
  if (body.action === "update" && typeof body.id === "number" && typeof body.quantity === "number") {
    await db.update(inventoryItems)
      .set({ quantity: body.quantity, updatedAt: now })
      .where(eq(inventoryItems.id, body.id));
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
