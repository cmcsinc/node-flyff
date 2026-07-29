/**
 * Query-string pagination helpers shared by the resource browser pages.
 *
 * Resource lists are built in-memory from cached YAML (see `lib/resources.ts`),
 * so slicing here is the whole story — there is no DB LIMIT/OFFSET to push down.
 *
 * @module lib/paginate
 */

export const PER_PAGE_OPTIONS = [25, 50, 100, 200, 500] as const;
export const DEFAULT_PER_PAGE = 50;

/** `?page=` → 1-based page number; anything unparseable falls back to 1. */
export function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** `?perPage=` → one of PER_PAGE_OPTIONS, else DEFAULT_PER_PAGE. */
export function parsePerPage(raw?: string): number {
  const n = Number(raw);
  return (PER_PAGE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PER_PAGE;
}

export interface Page<T> {
  rows: T[];
  /** Clamped page actually rendered (a stale `?page=` past the end lands on the last page). */
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
}

export function paginate<T>(rows: readonly T[], page: number, perPage: number): Page<T> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * perPage;
  return { rows: rows.slice(start, start + perPage), page: current, totalPages, total, perPage };
}
