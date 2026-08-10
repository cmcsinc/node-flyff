/**
 * Account create/update validation — shared by the API route (the guarantee)
 * and the modal forms (the UX). One schema so a field can never be accepted by
 * one side and rejected by the other.
 *
 * Username rules mirror the login-server's CERTIFY check
 * (`packages/login-server/src/handlers/auth.handler.ts:107` — `[a-zA-Z0-9_]`),
 * narrowed to the `accounts.username` column width (32).
 */

import { z } from 'zod';
import { AUTH, AUTH_VALUES } from '@flyff/entities/constants/authority';

/** AUTH_* tier as an ASCII code; default AUTH_GENERAL. Rejects unknown values. */
const authority = z
  .number()
  .int()
  .refine((v) => AUTH_VALUES.includes(v), 'Unknown authority tier');

/** Letters, digits, underscore — same charset the certifier accepts. */
export const USERNAME_RE = /^[A-Za-z0-9_]+$/;

export const USERNAME_MIN = 4;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 4;
/** Neuz's login field is short; keep well inside it so a typed password works. */
export const PASSWORD_MAX = 20;

const username = z
  .string()
  .min(USERNAME_MIN, `At least ${String(USERNAME_MIN)} characters`)
  .max(USERNAME_MAX, `At most ${String(USERNAME_MAX)} characters`)
  .regex(USERNAME_RE, 'Letters, digits and underscore only');

const password = z
  .string()
  .min(PASSWORD_MIN, `At least ${String(PASSWORD_MIN)} characters`)
  .max(PASSWORD_MAX, `At most ${String(PASSWORD_MAX)} characters`);

/** Empty input means "not set" → stored as NULL, never as "". */
const email = z
  .union([z.literal(''), z.string().max(255).email('Not a valid email')])
  .transform((v) => (v === '' ? null : v));

/** `banned_until` is a TEXT column; empty input means "no expiry". */
const bannedUntil = z
  .union([z.literal(''), z.string().datetime({ offset: true })])
  .transform((v) => (v === '' ? null : v));

export const CreateAccountSchema = z.object({
  username,
  password,
  email: email.optional().default(''),
  authority: authority.optional().default(AUTH.GENERAL),
  banned: z.boolean().optional().default(false),
});

export const UpdateAccountSchema = z
  .object({
    id: z.number().int().positive(),
    /** Omit to leave the current password untouched. */
    password: password.optional(),
    email: email.optional(),
    authority: authority.optional(),
    banned: z.boolean().optional(),
    bannedUntil: bannedUntil.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: 'No fields to update' });

export type CreateAccountInput = z.input<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.input<typeof UpdateAccountSchema>;

/**
 * Field-keyed errors for inline display. Returns `{}` when valid — the forms
 * render each message next to its own control rather than at the form top.
 */
export function fieldErrors(schema: z.ZodTypeAny, value: unknown): Record<string, string> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '_');
    out[key] ??= issue.message;
  }
  return out;
}
