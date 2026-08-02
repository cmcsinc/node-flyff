import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { hashAccountPassword } from "@/lib/password";
import { CreateAccountSchema, UpdateAccountSchema } from "@/lib/account-form";
import { loadActor, guardAccountWrite, guardAccountCreate } from "@/lib/account-guard";
import { writeAudit } from "@/lib/audit";

/**
 * Create an account usable by both the game client and the admin panel.
 *
 * The stored hash is `KDF(md5("kikugalanet" + typed))` via
 * `hashAccountPassword` — the same derivation the login-server's CERTIFY path
 * verifies, so a row minted here logs into Neuz unchanged.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CreateAccountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  const { username, password, email, authority, banned } = parsed.data;

  const actor = await loadActor(session);
  if (!actor) return NextResponse.json({ error: "Unknown actor" }, { status: 403 });
  const denied = guardAccountCreate(actor, authority);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.username, username))
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(accounts)
    .values({
      username,
      passwordHash: hashAccountPassword(password),
      email,
      authority,
      banned,
      bannedUntil: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: accounts.id });

  await writeAudit(session, {
    action: "account_create",
    targetType: "account",
    targetId: row?.id ?? null,
    details: { username, authority, banned },
  });

  return NextResponse.json({ ok: true, id: row?.id }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = UpdateAccountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  const { id, password, email, authority, banned, bannedUntil } = parsed.data;

  const actor = await loadActor(session);
  if (!actor) return NextResponse.json({ error: "Unknown actor" }, { status: 403 });
  const denied = await guardAccountWrite(actor, id, authority);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (password !== undefined) updates.passwordHash = hashAccountPassword(password);
  if (email !== undefined) updates.email = email;
  if (authority !== undefined) updates.authority = authority;
  if (banned !== undefined) updates.banned = banned;
  if (bannedUntil !== undefined) updates.bannedUntil = bannedUntil;

  await db.update(accounts).set(updates).where(eq(accounts.id, id));

  await writeAudit(session, {
    action: "account_update",
    targetType: "account",
    targetId: id,
    details: {
      // Never log the password itself -- only that it was rotated.
      passwordChanged: password !== undefined,
      ...(email !== undefined ? { email } : {}),
      ...(authority !== undefined ? { authority } : {}),
      ...(banned !== undefined ? { banned } : {}),
      ...(bannedUntil !== undefined ? { bannedUntil } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
