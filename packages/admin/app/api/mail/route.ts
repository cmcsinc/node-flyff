/**
 * Compose admin -> player mail.
 *
 * Inserts a `mail` row (sender 0 renders as "FLYFF" client-side) then nudges the
 * world so an online player sees it immediately. The nudge is best-effort: the
 * row is already persisted, so an offline world just means the player gets the
 * mail at next login.
 *
 * SECURITY: `auth()` first — the world trusts any signed envelope.
 *
 * @module app/api/mail/route
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { characters, mail } from "@/../drizzle/schema";
import { auth } from "@/lib/auth";
import { publishAdminCommand } from "@/lib/ipc";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Title <=31 and text <=255 are hard client limits: `CMailBox::Serialize`
 * writes them into a fixed archive and the client discards the remainder of the
 * stream past the overflow, so a longer string breaks the whole mailbox.
 */
const BodySchema = z.object({
  receiverId: z.number().int().positive(),
  title: z.string().min(1).max(31),
  text: z.string().max(255),
  /** __int64 penya — accepted as number or digit string, stored as string. */
  gold: z.union([z.number().int().min(0), z.string().regex(/^\d{1,19}$/)]).optional(),
  itemId: z.number().int().positive().optional(),
  itemCount: z.number().int().min(1).max(9999).optional(),
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

  const { receiverId, title, text, gold, itemId, itemCount } = parsed.data;

  const [receiver] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.id, receiverId))
    .limit(1);
  if (!receiver) {
    return NextResponse.json({ ok: false, error: "Character not found" }, { status: 404 });
  }

  await db.insert(mail).values({
    receiverId,
    senderId: 0,
    senderName: "FLYFF",
    title,
    text,
    gold: String(gold ?? 0),
    itemId: itemId ?? null,
    itemCount: itemId ? (itemCount ?? 1) : 0,
    read: false,
    takenItem: false,
    takenGold: false,
    createdAtMs: Date.now(),
  });

  // Best-effort nudge; the row is durable either way.
  const delivered = await publishAdminCommand({ kind: "mail_pushed", charId: receiverId });

  await writeAudit(session, {
    action: "mail_send",
    targetType: "character",
    targetId: receiverId,
    details: { title, gold: String(gold ?? 0), itemId: itemId ?? null, itemCount: itemCount ?? 0, delivered },
  });

  return NextResponse.json({ ok: true, delivered });
}
