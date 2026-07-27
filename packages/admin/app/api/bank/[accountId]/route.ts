import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bank } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
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
  const { tab, gold } = await req.json();

  if (typeof tab !== "number" || tab < 0 || tab > 2) {
    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  }
  if (typeof gold !== "number" || gold < 0) {
    return NextResponse.json({ error: "Invalid gold" }, { status: 400 });
  }

  const column = GOLD_COLS[tab];
  await db
    .insert(bank)
    .values({ accountId: accId, [column]: String(gold), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: bank.accountId,
      set: { [column]: String(gold), updatedAt: new Date().toISOString() },
    });

  return NextResponse.json({ ok: true });
}
