/**
 * Query-string column sorting for the server-rendered tables.
 *
 * The tables are already driven by `<form method="GET">` filters and
 * `?page=`/`?perPage=` links (see `lib/paginate.ts`), so sorting stays in the
 * URL too: it survives a refresh, is shareable, and needs no client JS.
 *
 * @module lib/sort
 */

export type SortDir = 'asc' | 'desc';

/**
 * A page's URL query string.
 *
 * The sort links, pagination links, and filter form all rebuild the query from
 * whatever the page received, so they need to enumerate its keys. A page's own
 * `SearchParams` should `extends QueryParams` — an interface without an index
 * signature is not assignable to a `Record`, which is what those helpers take.
 */
export type QueryParams = Record<string, string | undefined>;

export interface Sort<K extends string> {
  key: K | '';
  dir: SortDir;
}

/**
 * `?sort=`/`?dir=` → a validated sort. An unknown key yields `""` so the page
 * keeps its natural order rather than throwing on a hand-edited URL.
 */
export function parseSort<K extends string>(
  rawKey: string | undefined,
  rawDir: string | undefined,
  allowed: readonly K[],
  fallback?: { key: K; dir?: SortDir },
): Sort<K> {
  const key = rawKey && (allowed as readonly string[]).includes(rawKey) ? (rawKey as K) : '';
  if (!key) return { key: fallback?.key ?? '', dir: fallback?.dir ?? 'asc' };
  return { key, dir: rawDir === 'desc' ? 'desc' : 'asc' };
}

/** Primitives keep their own form; anything else degrades to "" rather than
    "[object Object]", so an accidentally-passed object sorts inertly. */
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  return '';
}

/** Numbers compare numerically, everything else by locale-aware string order. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Stable sort by one field. Returns the input untouched when no key is active,
 * so a page's own default ordering is preserved.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: Sort<K>,
  /** Field accessor per sortable key. Missing keys fall back to `row[key]`. */
  accessors?: Partial<Record<K, (row: T) => unknown>>,
): T[] {
  if (!sort.key) return rows as T[];
  const key = sort.key;
  const get = accessors?.[key] ?? ((row: T): unknown => (row as Record<string, unknown>)[key]);
  const sign = sort.dir === 'desc' ? -1 : 1;
  // `.map` to index keeps the sort stable across engines that don't guarantee it.
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => compare(get(x.row), get(y.row)) * sign || x.i - y.i)
    .map((e) => e.row);
}

/**
 * Link target for a header cell: same query string, `sort` set to `key`, `dir`
 * toggled when the column is already active, and `page` dropped so re-sorting
 * lands on page 1 instead of a now-meaningless offset.
 */
export function sortHref(
  params: Record<string, string | undefined>,
  key: string,
  current: Sort<string>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'sort' && k !== 'dir' && k !== 'page' && v) qs.set(k, v);
  }
  qs.set('sort', key);
  if (current.key === key && current.dir === 'asc') qs.set('dir', 'desc');
  const s = qs.toString();
  return s ? `?${s}` : '?';
}
