import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { bank, bankItems } from '@/../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/lib/auth';

const GOLD_COLS = ['gold', 'gold_tab1', 'gold_tab2'] as const;
const BodySchema = z.union([
  z.object({ tab: z.number().int().min(0).max(2), gold: z.number().min(0) }),
  z.object({
    action: z.literal('add'),
    itemId: z.number(),
    tab: z.number().int(),
    quantity: z.number().optional(),
    slot: z.number().optional(),
  }),
  z.object({ action: z.literal('update'), id: z.number(), quantity: z.number() }),
  z.object({ action: z.literal('delete'), id: z.number() }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountId } = await params;
  const accId = Number(accountId);
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const body = parsed.data;
  const now = new Date().toISOString();

  // Gold update: { tab, gold }
  if ('gold' in body) {
    const { tab, gold } = body;
    if (tab < 0 || tab > 2) return NextResponse.json({ error: 'Invalid tab' }, { status: 400 });
    if (gold < 0) return NextResponse.json({ error: 'Invalid gold' }, { status: 400 });
    const column = GOLD_COLS[tab];
    await db
      .insert(bank)
      .values({ accountId: accId, [column]: String(gold), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: bank.accountId,
        set: { [column]: String(gold), updatedAt: now },
      });
    return NextResponse.json({ ok: true });
  }

  // Add bank item: { action: "add", itemId, tab, quantity?, slot? }
  if ('action' in body && body.action === 'add') {
    const qty = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;
    let slot = body.slot;
    if (typeof slot !== 'number') {
      const existing = await db
        .select({ slot: bankItems.slot })
        .from(bankItems)
        .where(and(eq(bankItems.accountId, accId), eq(bankItems.tab, body.tab)));
      const used = new Set(existing.map((r) => r.slot));
      slot = 0;
      while (used.has(slot)) slot++;
    }
    await db.insert(bankItems).values({
      accountId: accId,
      tab: body.tab,
      slot,
      itemId: body.itemId,
      quantity: qty,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, slot });
  }

  // Update bank item quantity: { action: "update", id, quantity }
  if (
    'action' in body &&
    body.action === 'update' &&
    typeof body.id === 'number' &&
    typeof body.quantity === 'number'
  ) {
    await db
      .update(bankItems)
      .set({ quantity: body.quantity, updatedAt: now })
      .where(eq(bankItems.id, body.id));
    return NextResponse.json({ ok: true });
  }

  // Delete bank item: { action: "delete", id }
  if (body.action === 'delete' && typeof body.id === 'number') {
    await db.delete(bankItems).where(eq(bankItems.id, body.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
}
