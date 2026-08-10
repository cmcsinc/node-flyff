import type * as React from 'react';
import { itemRows } from '@/lib/resource-rows';
import { getIk2Label, getIk3Label } from '@/lib/game-constants';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import {
  IdCell,
  NameCell,
  TagCell,
  NumCell,
  EditLink,
  MutedCell,
} from '@/components/resource-cells';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { Package } from 'lucide-react';
import type { ItemRow } from '@/lib/resource-rows';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  kind?: string;
  sub?: string;
  group?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = [
  'id',
  'name',
  'kind2',
  'kind3',
  'group',
  'price',
  'weight',
  'stackSize',
] as const;

const COLUMNS: readonly ResourceColumn<ItemRow>[] = [
  {
    key: 'id',
    header: 'ID',
    sortable: true,
    className: 'w-20',
    cell: (r) => <IdCell value={r.id} />,
  },
  { key: 'name', header: 'Name', sortable: true, cell: (r) => <NameCell value={r.name} /> },
  {
    key: 'kind2',
    header: 'Kind',
    sortable: true,
    cell: (r) => <TagCell label={r.kind2} title={r.kind2Sym} />,
  },
  {
    key: 'kind3',
    header: 'Subtype',
    sortable: true,
    cell: (r) => <MutedCell value={r.kind3} title={r.kind3Sym} />,
  },
  {
    key: 'price',
    header: 'Price',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.price} />,
  },
  {
    key: 'weight',
    header: 'Weight',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.weight} />,
  },
  {
    key: 'stackSize',
    header: 'Stack',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.stackSize} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (r) => (
      <EditLink href={`/resources/items/${String(r.id)}/edit`} label={`item ${String(r.id)}`} />
    ),
  },
];

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const kind = params.kind ?? '';
  const sub = params.sub ?? '';
  const group = params.group ?? '';
  const perPage = parsePerPage(params.perPage);

  const items = itemRows();
  const kinds = [...new Set(items.map((i) => i.kind2Sym).filter(Boolean))].sort();
  const subs = [...new Set(items.map((i) => i.kind3Sym).filter(Boolean))].sort();
  const groups = [...new Set(items.map((i) => i.group).filter(Boolean))].sort();

  const needle = search.toLowerCase();
  const filtered = items.filter((i) => {
    if (kind && i.kind2Sym !== kind) return false;
    if (sub && i.kind3Sym !== sub) return false;
    if (group && i.group !== group) return false;
    if (needle && !i.name.toLowerCase().includes(needle) && !String(i.id).includes(needle))
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || kind || sub || group);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        description={`${filtered.length.toLocaleString()} of ${items.length.toLocaleString()} item definitions`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by name or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Select name="kind" defaultValue={kind} className="w-44" aria-label="Filter by item kind">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {getIk2Label(k)}
            </option>
          ))}
        </Select>
        <Select name="sub" defaultValue={sub} className="w-44" aria-label="Filter by item subtype">
          <option value="">All subtypes</option>
          {subs.map((s) => (
            <option key={s} value={s}>
              {getIk3Label(s)}
            </option>
          ))}
        </Select>
        <Select
          name="group"
          defaultValue={group}
          className="w-36"
          aria-label="Filter by resource file"
        >
          <option value="">All files</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => `${r.group}-${String(r.id)}`}
        sort={sort}
        params={params}
        unit="items"
        empty={{
          icon: Package,
          message: active ? 'No items match your filters' : 'No item data in resources/data/items/',
        }}
      />
    </div>
  );
}
