import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bank, bankItems } from "@/../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

const GOLD_COLS = ["gold", "gold_tab1", "gold_tab2"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accountId } = await params;
  const accId = Number(accountId);
  const body = await req.json();
  const now = new Date().toISOString();

  // Gold update: { tab, gold }
  if (typeof body.tab === "number" && typeof body.gold === "number") {
    const { tab, gold } = body;
    if (tab < 0 || tab > 2) return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
    if (gold < 0) return NextResponse.json({ error: "Invalid gold" }, { status: 400 });
    const column = GOLD_COLS[tab];
    await db.insert(bank)
      .values({ accountId: accId, [column]: String(gold), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: bank.accountId, set: { [column]: String(gold), updatedAt: now } });
    return NextResponse.json({ ok: true });
  }

  // Add bank item: { action: "add", itemId, tab, quantity?, slot? }
  if (body.action === "add" && typeof body.itemId === "number" && typeof body.tab === "number") {
    const qty = typeof body.quantity === "number" && body.quantity > 0 ? body.quantity : 1;
    let slot = body.slot;
    if (typeof slot !== "number") {
      const existing = await db.select({ slot: bankItems.slot })
        .from(bankItems).where(and(eq(bankItems.accountId, accId), eq(bankItems.tab, body.tab)));
      const used = new Set(existing.map(r => r.slot));
      slot = 0;
      while (used.has(slot)) slot++;
    }
    await db.insert(bankItems).values({
      accountId: accId, tab: body.tab, slot, itemId: body.itemId, quantity: qty, createdAt: now, updatedAt: now,
    });
    return NextResponse.json({ ok: true, slot });
  }

  // Update bank item quantity: { action: "update", id, quantity }
  if (body.action === "update" && typeof body.id === "number" && typeof body.quantity === "number") {
    await db.update(bankItems).set({ quantity: body.quantity, updatedAt: now }).where(eq(bankItems.id, body.id));
    return NextResponse.json({ ok: true });
  }

  // Delete bank item: { action: "delete", id }
  if (body.action === "delete" && typeof body.id === "number") {
    await db.delete(bankItems).where(eq(bankItems.id, body.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "No valid fields" }, { status: 400 });
}
