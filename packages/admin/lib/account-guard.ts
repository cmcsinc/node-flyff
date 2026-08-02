/**
 * DB-bound privilege guards for account mutations. The rules themselves live in
 * `lib/account-tiers.ts` (pure, unit-tested); this module only resolves the
 * actor and the target row and delegates.
 *
 * @module lib/account-guard
 */

import { db } from "@/lib/db";
import { accounts } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { resolveActorAccountId } from "@/lib/audit";
import { checkAccountWrite, type Actor, type Denial } from "@/lib/account-tiers";

export { guardAccountCreate } from "@/lib/account-tiers";
export type { Actor, Denial } from "@/lib/account-tiers";

/** The signed-in GM's account id + tier, or null when it can't be resolved. */
export async function loadActor(session: Session): Promise<Actor | null> {
  const id = await resolveActorAccountId(session);
  if (id <= 0) return null;
  const [row] = await db
    .select({ authority: accounts.authority })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  if (!row) return null;
  return { id, authority: row.authority };
}

/** Guard a mutation of `targetId` by `actor`. */
export async function guardAccountWrite(
  actor: Actor,
  targetId: number,
  newAuthority: number | undefined,
): Promise<Denial> {
  const [target] = await db
    .select({ authority: accounts.authority })
    .from(accounts)
    .where(eq(accounts.id, targetId))
    .limit(1);
  if (!target) return "Account not found";
  return checkAccountWrite(actor, targetId, target.authority, newAuthority);
}
