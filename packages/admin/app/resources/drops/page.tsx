import type * as React from 'react';
import { dropRows } from '@/lib/resource-rows';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import { IdCell, NameWithSymbol, NumCell, Dash, EditLink } from '@/components/resource-cells';
import { ItemChipList } from '@/components/item-chip-list';
import { ChanceCell } from '@/components/chance-cell';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { Gem } from 'lucide-react';
import type { DropRow } from '@/lib/resource-rows';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  item?: string;
  minChance?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = [
  'key',
  'moverName',
  'modelIdx',
  'goldMin',
  'maxItem',
  'count',
  'bestChance',
] as const;

const COLUMNS: readonly ResourceColumn<DropRow>[] = [
  {
    key: 'modelIdx',
    header: 'Model',
    sortable: true,
    className: 'w-20',
    cell: (r) => <IdCell value={r.modelIdx} />,
  },
  {
    key: 'moverName',
    header: 'Monster',
    sortable: true,
    cell: (r) => <NameWithSymbol name={r.moverName} symbol={r.key} />,
  },
  {
    key: 'itemIds',
    header: 'Drops',
    // The point of the page: what this monster gives you, by name. Capped at 4
    // chips so one 20-slot table cannot make its row four lines tall.
    cell: (r) => <ItemChipList names={r.itemNames} ids={r.itemIds} max={4} />,
  },
  {
    key: 'bestChance',
    header: 'Best chance',
    sortable: true,
    align: 'right',
    // The table's headline rate, not a sum: adding 20 slots up yields a number
    // over 100 that means nothing.
    cell: (r) => <ChanceCell pct={r.bestChance} />,
  },
  {
    key: 'goldMin',
    header: 'Penya',
    sortable: true,
    align: 'right',
    // A range, not a string: the row keeps min/max numeric so this column sorts
    // on the number rather than re-parsing a rendered "6–9".
    cell: (r) =>
      r.goldMin || r.goldMax ? (
        <span className="font-mono text-xs tabular-nums">
          {r.goldMin.toLocaleString()}–{r.goldMax.toLocaleString()}
        </span>
      ) : (
        <Dash />
      ),
  },
  {
    key: 'maxItem',
    header: 'Max drops',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.maxItem} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    className: 'w-24',
    align: 'right',
    // Keyed by the MI_* symbol, not a numeric id — a drop table has no `id`.
    cell: (r) => (
      <EditLink
        href={`/resources/drops/${encodeURIComponent(r.key)}/edit`}
        label={`drop table ${r.key}`}
      />
    ),
  },
];

export default async function DropsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const item = params.item ?? '';
  const minChance = params.minChance ?? '';
  const perPage = parsePerPage(params.perPage);

  const drops = dropRows();
  const minPct = Number(minChance);
  const needle = search.toLowerCase();
  const itemNeedle = item.trim().toLowerCase();

  const filtered = drops.filter((d) => {
    // Filter by dropped item *name*: a GM knows "Twinklestone", not 2950.
    if (itemNeedle && !d.itemNames.some((n) => n.toLowerCase().includes(itemNeedle))) return false;
    if (minChance && Number.isFinite(minPct) && d.bestChance < minPct) return false;
    // Search spans the resolved monster name as well as the MI_* key, so a GM
    // can type "Aibatt" without knowing the symbol.
    if (
      needle &&
      !d.key.toLowerCase().includes(needle) &&
      !d.moverName.toLowerCase().includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || item || minChance);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drops"
        description={`${filtered.length.toLocaleString()} of ${drops.length.toLocaleString()} drop tables`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search monster name or MI_ key..."
          defaultValue={search}
          className="w-full sm:w-64"
        />
        <SearchInput
          name="item"
          placeholder="Drops an item named..."
          aria-label="Filter by dropped item name"
          defaultValue={item}
          className="w-full sm:w-56"
        />
        <Input
          name="minChance"
          type="number"
          min={0}
          max={100}
          step="any"
          defaultValue={minChance}
          placeholder="Min chance %"
          aria-label="Minimum best drop chance, percent"
          className="w-36"
        />
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.key}
        sort={sort}
        params={params}
        unit="drop tables"
        empty={{
          icon: Gem,
          message: active ? 'No drop tables match your filters' : 'No drop data',
        }}
      />
    </div>
  );
}
