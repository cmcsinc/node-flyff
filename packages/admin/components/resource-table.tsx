/**
 * The one table shell every `/resources/*` browser page renders.
 *
 * Before this existed, each of the nine pages hand-rolled the same forty lines
 * of chrome — `Card` > `CardContent p-0` > `overflow-auto` > sticky `TableHeader`
 * > `SortableHead` per column > `EmptyRow` with a hand-counted `colSpan` >
 * `Pagination`. They drifted: different empty-state copy shapes, a `colSpan`
 * that had to be updated by hand whenever a column was added, `Actions` headers
 * that were sometimes present and sometimes called `Edit`.
 *
 * Here a page declares its columns and rows and gets identical structure,
 * spacing, sort affordances, alignment, and empty state. `colSpan` is derived,
 * so it can no longer be wrong.
 *
 * @module components/resource-table
 */

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  SortableHead,
} from '@/components/ui/table';
import { EmptyRow } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { cn } from '@/lib/utils';
import type { Page } from '@/lib/paginate';
import type { Sort } from '@/lib/sort';

type Align = 'left' | 'right' | 'center';

export interface ResourceColumn<T> {
  /** Sort key when sortable; also the React key for the cell. */
  key: string;
  header: string;
  align?: Align;
  /** Width/utility classes applied to both the header and its cells. */
  className?: string;
  /** Omit to render a plain, unsortable header (action columns). */
  sortable?: boolean;
  cell: (row: T) => React.ReactNode;
}

interface ResourceTableProps<T> {
  columns: readonly ResourceColumn<T>[];
  page: Page<T>;
  rowKey: (row: T) => React.Key;
  sort: Sort<string>;
  params: Record<string, string | undefined>;
  /** Row-count noun for the pagination footer ("items", "quests", …). */
  unit: string;
  /** Icon + message for the zero-row state. */
  empty: { icon: React.ComponentType<{ className?: string }>; message: string };
}

function alignClass(align: Align | undefined): string | undefined {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return undefined;
}

export function ResourceTable<T>({
  columns,
  page,
  rowKey,
  sort,
  params,
  unit,
  empty,
}: ResourceTableProps<T>): React.JSX.Element {
  const { icon: EmptyIcon, message } = empty;

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          {/* Sticky so the column meaning survives scrolling a 5 000-row page.
              The shadow stands in for a border, which `position: sticky` drops. */}
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
            <TableRow className="hover:bg-transparent">
              {columns.map((col) =>
                col.sortable ? (
                  <SortableHead
                    key={col.key}
                    sortKey={col.key}
                    sort={sort}
                    params={params}
                    align={col.align}
                    className={col.className}
                  >
                    {col.header}
                  </SortableHead>
                ) : (
                  <TableHead key={col.key} className={cn(col.className, alignClass(col.align))}>
                    {col.header}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((col) => (
                  <TableCell key={col.key} className={cn(col.className, alignClass(col.align))}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {page.total === 0 && (
              <EmptyRow colSpan={columns.length}>
                <div className="flex flex-col items-center gap-2">
                  <EmptyIcon className="h-5 w-5 opacity-40" />
                  {message}
                </div>
              </EmptyRow>
            )}
          </TableBody>
        </Table>
        <Pagination {...page} params={params} unit={unit} />
      </CardContent>
    </Card>
  );
}
