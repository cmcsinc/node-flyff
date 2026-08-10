import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { inventory, inventoryItems } from '@/../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/lib/auth';

const PatchSchema = z.union([
  z.object({ gold: z.number() }),
  z.object({
    action: z.literal('add'),
    itemId: z.number(),
    quantity: z.number().optional(),
    slot: z.number().optional(),
  }),
  z.object({ action: z.literal('update'), id: z.number(), quantity: z.number() }),
]);
const DeleteSchema = z.object({ slot: z.number() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ characterId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { characterId } = await params;
  const charId = Number(characterId);
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const body = parsed.data;

  const now = new Date().toISOString();

  if ('gold' in body) {
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
  if ('action' in body && body.action === 'add') {
    const qty = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;
    // Find next free slot if not specified
    let slot = body.slot;
    if (typeof slot !== 'number') {
      const existing = await db
        .select({ slot: inventoryItems.slot })
        .from(inventoryItems)
        .where(eq(inventoryItems.characterId, charId));
      const used = new Set(existing.map((r) => r.slot));
      slot = 0;
      while (used.has(slot)) slot++;
    }
    await db.insert(inventoryItems).values({
      characterId: charId,
      slot,
      itemId: body.itemId,
      quantity: qty,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, slot });
  }

  // Update quantity: { action: "update", id, quantity }
  await db
    .update(inventoryItems)
    .set({ quantity: body.quantity, updatedAt: now })
    .where(eq(inventoryItems.id, body.id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ characterId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { characterId } = await params;
  const charId = Number(characterId);
  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 });
  }
  const { slot } = parsed.data;

  if (!Number.isInteger(slot)) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 });
  }

  await db
    .delete(inventoryItems)
    .where(and(eq(inventoryItems.characterId, charId), eq(inventoryItems.slot, slot)));

  return NextResponse.json({ ok: true });
}
