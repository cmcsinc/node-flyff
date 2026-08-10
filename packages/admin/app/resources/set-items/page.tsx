import type * as React from 'react';
import { setItemRows } from '@/lib/resource-rows';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import { NameCell, SymbolCell, CountCell, EditLink } from '@/components/resource-cells';
import { ItemChipList } from '@/components/item-chip-list';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { Gem } from 'lucide-react';
import type { SetItemRow } from '@/lib/resource-rows';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  item?: string;
  minPieces?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ['id', 'name', 'nameId', 'pieces', 'bonuses'] as const;

const COLUMNS: readonly ResourceColumn<SetItemRow>[] = [
  { key: 'name', header: 'Set', sortable: true, cell: (r) => <NameCell value={r.name} /> },
  {
    key: 'nameId',
    header: 'Name ID',
    sortable: true,
    // Trimmed of its shared prefix; the full token is in the tooltip.
    cell: (r) => (
      <SymbolCell value={r.nameId.replace(/^IDS_PROPITEMETC_INC_/, '')} title={r.nameId} />
    ),
  },
  {
    key: 'items',
    header: 'Pieces',
    // Names, not ids: `4587` tells a GM nothing the client's "Leaf Hat" does.
    cell: (r) => <ItemChipList names={r.itemNames} ids={r.itemIds} />,
  },
  {
    key: 'pieces',
    header: '#',
    sortable: true,
    align: 'right',
    className: 'w-16',
    cell: (r) => <CountCell value={r.pieces} />,
  },
  {
    key: 'bonuses',
    header: 'Bonuses',
    sortable: true,
    align: 'right',
    className: 'w-24',
    cell: (r) => <CountCell value={r.bonuses} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    className: 'w-24',
    cell: (r) => (
      <EditLink href={`/resources/set-items/${String(r.id)}/edit`} label={`set ${String(r.id)}`} />
    ),
  },
];

export default async function SetItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const item = params.item ?? '';
  const minPieces = params.minPieces ?? '';
  const perPage = parsePerPage(params.perPage);

  const sets = setItemRows();
  const minP = Number(minPieces);
  const needle = search.toLowerCase();
  const pieceNeedle = item.trim().toLowerCase();

  const filtered = sets.filter((s) => {
    // Member filter is by piece *name*: a GM knows "Leaf Hat", not 4587.
    if (pieceNeedle && !s.itemNames.some((n) => n.toLowerCase().includes(pieceNeedle)))
      return false;
    if (minPieces && Number.isFinite(minP) && s.pieces < minP) return false;
    // The token is searchable too — a GM cross-referencing propItemEtc.inc has
    // only the IDS_* token to go on.
    if (
      needle &&
      !s.name.toLowerCase().includes(needle) &&
      !s.nameId.toLowerCase().includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || item || minPieces);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Set Items"
        description={`${filtered.length.toLocaleString()} of ${sets.length.toLocaleString()} set definitions`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search set name or token..."
          defaultValue={search}
          className="w-full sm:w-64"
        />
        <SearchInput
          name="item"
          placeholder="Contains piece named..."
          aria-label="Filter by set piece name"
          defaultValue={item}
          className="w-full sm:w-56"
        />
        <Input
          name="minPieces"
          type="number"
          min={0}
          defaultValue={minPieces}
          placeholder="Min pieces"
          aria-label="Minimum piece count"
          className="w-32"
        />
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.id}
        sort={sort}
        params={params}
        unit="sets"
        empty={{ icon: Gem, message: active ? 'No sets match your filters' : 'No set item data' }}
      />
    </div>
  );
}
