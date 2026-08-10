import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PER_PAGE_OPTIONS } from '@/lib/paginate';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  /** Current query string params — preserved (minus `page`) in the page links. */
  params: Record<string, string | undefined>;
  /** Label for the row count, e.g. "items". */
  unit?: string;
}

function href(params: Record<string, string | undefined>, page: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'page' && v) qs.set(k, v);
  }
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `?${s}` : '?';
}

/** Windowed page numbers around the current page, always including first/last. */
function windowed(page: number, totalPages: number): number[] {
  const pages = new Set<number>([1, totalPages]);
  for (let p = page - 2; p <= page + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Query-string pagination footer. Server-rendered links only — no client JS, so
 * it works with the plain `<form method="GET">` filter bars on the resource pages.
 */
export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  params,
  unit = 'rows',
}: PaginationProps): React.JSX.Element {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const nums = windowed(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm"
    >
      <p className="text-xs text-muted-foreground">
        {/* Grouped digits, matching the page header's count — a footer reading
            "of 5500" beside a header reading "5,500" looks like two figures. */}
        {total === 0
          ? `No ${unit}`
          : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${unit}`}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <PageLink href={href(params, page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </PageLink>

          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && nums[i - 1] !== n - 1 && (
                <span className="px-1 text-muted-foreground">…</span>
              )}
              <Link
                href={href(params, n)}
                aria-current={n === page ? 'page' : undefined}
                className={cn(
                  'min-w-8 rounded-md border px-2 py-1 text-center text-xs transition-colors',
                  n === page
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-input text-muted-foreground hover:border-ring/40 hover:text-foreground',
                )}
              >
                {n}
              </Link>
            </span>
          ))}

          <PageLink href={href(params, page + 1)} disabled={page >= totalPages} label="Next page">
            <ChevronRight className="h-4 w-4" />
          </PageLink>
        </div>
      )}
    </nav>
  );
}

function PageLink({
  href: to,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const cls = 'rounded-md border border-input p-1.5 transition-colors';
  if (disabled) {
    return (
      <span aria-disabled="true" aria-label={label} className={cn(cls, 'opacity-40')}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={to}
      aria-label={label}
      className={cn(cls, 'hover:border-ring/40 hover:text-primary')}
    >
      {children}
    </Link>
  );
}

export { PER_PAGE_OPTIONS };
