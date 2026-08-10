/**
 * Admin audit trail.
 *
 * Every state-changing GM action (kick, teleport, mail) writes one row. The
 * actor is the signed-in GM account: next-auth's JWT strategy carries the
 * account id in `session.user.id` (set from `authorize()`'s `id`), but we fall
 * back to a username lookup so a stale cookie shape can't lose attribution.
 *
 * @module lib/audit
 */

import { db } from '@/lib/db';
import { accounts, adminAuditLog } from '@/../drizzle/schema';
import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';

/** Resolve the acting GM's account id, or 0 when it can't be determined. */
export async function resolveActorAccountId(session: Session): Promise<number> {
  const raw = session.user?.id;
  const id = raw === undefined ? NaN : Number(raw);
  if (Number.isInteger(id) && id > 0) return id;

  const name = session.user?.name;
  if (!name) return 0;
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.username, name))
    .limit(1);
  return row.id;
}

/** Append one audit row. `details` is stored as JSON text. */
export async function writeAudit(
  session: Session,
  entry: {
    action: string;
    targetType: string;
    targetId: number | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(adminAuditLog).values({
    accountId: await resolveActorAccountId(session),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details ? JSON.stringify(entry.details) : null,
  });
}
