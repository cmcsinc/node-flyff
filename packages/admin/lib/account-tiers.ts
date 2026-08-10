/**
 * Pure privilege rules for account mutations — no DB, no session, so they are
 * directly unit-testable (`test/account-guard.test.ts`).
 *
 * The panel admits anyone `>= AUTH_GAMEMASTER` (`lib/auth.ts`), so "has a
 * session" is NOT sufficient authority to edit accounts: without a tier compare
 * a tier-1 GM could PATCH their own row to ADMINISTRATOR, or reset the password
 * of an account above them. C++ has no admin panel to mirror here, so the rule
 * is the conservative reading of its ordinal ladder: you may only act on
 * accounts strictly below you, and may only grant a tier strictly below your own.
 *
 * @module lib/account-tiers
 */

import { AUTH, hasAuthority } from '@flyff/entities/constants/authority';

export interface Actor {
  id: number;
  authority: number;
}

/** Denial reason, or null when the write is allowed. */
export type Denial = string | null;

/**
 * Pure write decision.
 *
 * `newAuthority` is the requested tier when the write changes it (undefined
 * otherwise). Granting any tier requires OPERATOR or above — a GM should not be
 * able to mint staff at all.
 */
export function checkAccountWrite(
  actor: Actor,
  targetId: number,
  targetAuthority: number,
  newAuthority: number | undefined,
): Denial {
  // Self-edit would let any GM lift their own ceiling.
  if (actor.id === targetId) return 'You cannot modify your own account';

  // Acting on a peer or a superior.
  if (targetAuthority >= actor.authority) {
    return "That account's authority is equal to or above yours";
  }

  if (newAuthority !== undefined) {
    if (!hasAuthority(actor.authority, AUTH.OPERATOR)) {
      return 'Changing authority requires Operator or above';
    }
    if (newAuthority >= actor.authority) {
      return 'You cannot grant an authority at or above your own';
    }
  }

  return null;
}

/** Minting a new account: only staff at OPERATOR+ may set a non-player tier. */
export function guardAccountCreate(actor: Actor, authority: number): Denial {
  if (authority === AUTH.GENERAL) return null;
  if (!hasAuthority(actor.authority, AUTH.OPERATOR)) {
    return 'Creating a staff account requires Operator or above';
  }
  if (authority >= actor.authority) {
    return 'You cannot grant an authority at or above your own';
  }
  return null;
}
