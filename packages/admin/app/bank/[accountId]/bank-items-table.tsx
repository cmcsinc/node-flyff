'use client';

import { DataTable } from '@/components/data-table';

export interface BankItemRow {
  id: number;
  slot: number;
  itemId: number;
  quantity: number;
  refine: number;
  durability: number;
}

/**
 * Sortable bank-tab item list.
 *
 * A client component on purpose: the column definitions hold render and sort
 * *functions*, which cannot be passed from a server component. The page ships
 * only plain rows.
 */
export function BankItemsTable({ rows }: { rows: readonly BankItemRow[] }): React.JSX.Element {
  return (
    <DataTable
      rows={rows}
      rowKey={(i) => i.id}
      initialSort={{ key: 'slot' }}
      empty="Empty tab"
      columns={[
        { key: 'slot', header: 'Slot', align: 'right', className: 'font-mono text-xs' },
        { key: 'itemId', header: 'Item ID', align: 'right', className: 'font-medium' },
        { key: 'quantity', header: 'Qty', align: 'right' },
        {
          key: 'refine',
          header: 'Refine',
          align: 'right',
          cell: (i) => (i.refine > 0 ? `+${String(i.refine)}` : '—'),
        },
        {
          key: 'durability',
          header: 'Durability',
          align: 'right',
          // -1 is the C++ sentinel for indestructible.
          cell: (i) => (i.durability === -1 ? '∞' : i.durability),
        },
      ]}
    />
  );
}
