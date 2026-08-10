'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyRow } from '@/components/empty-state';
import type { SortDir } from '@/lib/sort';

export interface Column<T> {
  /** Stable id, also the default field name when `value` is omitted. */
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Sort value. Defaults to `row[key]`. Pass `null` to make the column unsortable. */
  value?: ((row: T) => unknown) | null;
  /** Rendered cell. Defaults to the stringified `row[key]`. */
  cell?: (row: T) => React.ReactNode;
}

/** Primitives compare by kind; anything else falls back to a safe string form. */
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  return '';
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Client-sorted table for panels whose surrounding state is not in the URL
 * (the account/bank detail tabs). Sorting there must not navigate — a
 * query-string sort would reset the active tab — so the order lives in local
 * state instead. URL-driven pages use `SortableHead` + `lib/sort` instead.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  initialSort,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => React.Key;
  empty: React.ReactNode;
  initialSort?: { key: string; dir?: SortDir };
}): React.JSX.Element {
  const [sortKey, setSortKey] = React.useState(initialSort?.key ?? '');
  const [dir, setDir] = React.useState<SortDir>(initialSort?.dir ?? 'asc');

  const sorted = React.useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows as T[];
    const get = col.value ?? ((row: T): unknown => (row as Record<string, unknown>)[col.key]);
    const sign = dir === 'desc' ? -1 : 1;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((x, y) => compare(get(x.row), get(y.row)) * sign || x.i - y.i)
      .map((e) => e.row);
  }, [rows, columns, sortKey, dir]);

  function toggle(key: string): void {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setDir('asc');
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((col) => {
            const active = col.key === sortKey;
            const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
            if (col.value === null) {
              return (
                <TableHead key={col.key} className={cn(col.className, alignClass(col.align))}>
                  {col.header}
                </TableHead>
              );
            }
            return (
              <TableHead
                key={col.key}
                aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={cn('p-0', col.className)}
              >
                <button
                  type="button"
                  onClick={() => {
                    toggle(col.key);
                  }}
                  aria-label={`Sort by ${col.header}, ${
                    active && dir === 'asc' ? 'descending' : 'ascending'
                  }`}
                  className={cn(
                    'flex h-10 w-full items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-foreground',
                    col.align === 'right' && 'justify-end',
                    col.align === 'center' && 'justify-center',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span className="truncate">{col.header}</span>
                  <Icon
                    aria-hidden
                    className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary' : 'opacity-40')}
                  />
                </button>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((col) => (
              <TableCell key={col.key} className={cn(col.className, alignClass(col.align))}>
                {col.cell ? col.cell(row) : text((row as Record<string, unknown>)[col.key])}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {sorted.length === 0 && <EmptyRow colSpan={columns.length}>{empty}</EmptyRow>}
      </TableBody>
    </Table>
  );
}

function alignClass(align?: 'left' | 'right' | 'center'): string | undefined {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return undefined;
}
