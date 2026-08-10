import type * as React from 'react';
import { moverRows, BELLI_INFO } from '@/lib/resource-rows';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import {
  IdCell,
  NameWithSymbol,
  TagCell,
  NumCell,
  EditLink,
  Dash,
} from '@/components/resource-cells';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { Bug } from 'lucide-react';
import type { MoverRow } from '@/lib/resource-rows';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  type?: string;
  belli?: string;
  minLevel?: string;
  maxLevel?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ['id', 'name', 'key', 'type', 'level', 'hp', 'exp', 'belliLabel'] as const;

const COLUMNS: readonly ResourceColumn<MoverRow>[] = [
  {
    key: 'id',
    header: 'ID',
    sortable: true,
    className: 'w-20',
    cell: (r) => <IdCell value={r.id} />,
  },
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    cell: (r) => <NameWithSymbol name={r.name} symbol={r.key} />,
  },
  { key: 'type', header: 'Type', sortable: true, cell: (r) => <TagCell label={r.type} /> },
  {
    key: 'level',
    header: 'Level',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.level} />,
  },
  {
    key: 'hp',
    header: 'HP',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.hp} />,
  },
  {
    key: 'exp',
    header: 'EXP',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.exp} />,
  },
  {
    key: 'belliLabel',
    header: 'Behaviour',
    sortable: true,
    // Sight-aggro mobs get the warning variant: this column decides whether a
    // mob attacks unprovoked, worth spotting before the word is read. Never
    // colour-only — the label says it too, and the C++ symbol is in the tooltip
    // so a GM can match the row against defineAttribute.h.
    cell: (r) =>
      r.belliLabel ? (
        <Badge
          variant={r.aggro ? 'warning' : 'secondary'}
          title={
            r.belliSym ? `${r.belliSym} (${String(r.belli)})` : `dwBelligerence ${String(r.belli)}`
          }
        >
          {r.belliLabel}
        </Badge>
      ) : (
        <Dash />
      ),
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (r) => (
      <EditLink href={`/resources/movers/${String(r.id)}/edit`} label={`mover ${r.key}`} />
    ),
  },
];

export default async function MoversPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const type = params.type ?? '';
  const belli = params.belli ?? '';
  const minLevel = params.minLevel ?? '';
  const maxLevel = params.maxLevel ?? '';
  const perPage = parsePerPage(params.perPage);

  const movers = moverRows();
  const types = [...new Set(movers.map((m) => m.type).filter(Boolean))].sort();
  const bellis = [...new Set(movers.map((m) => m.belli).filter(Boolean))].sort((a, b) => a - b);

  const min = Number(minLevel);
  const max = Number(maxLevel);
  const needle = search.toLowerCase();

  const filtered = movers.filter((m) => {
    if (type && m.type !== type) return false;
    if (belli && m.belli !== Number(belli)) return false;
    if (minLevel && Number.isFinite(min) && m.level < min) return false;
    if (maxLevel && Number.isFinite(max) && m.level > max) return false;
    if (
      needle &&
      !m.name.toLowerCase().includes(needle) &&
      !m.key.toLowerCase().includes(needle) &&
      !String(m.id).includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || type || belli || minLevel || maxLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movers"
        description={`${filtered.length.toLocaleString()} of ${movers.length.toLocaleString()} mover definitions`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by name, MI_ key, or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Select name="type" defaultValue={type} className="w-36" aria-label="Filter by mover type">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select name="belli" defaultValue={belli} className="w-52" aria-label="Filter by behaviour">
          <option value="">All behaviours</option>
          {bellis.map((b) => (
            <option key={b} value={b}>
              {BELLI_INFO.get(b)?.label ?? `BELLI ${String(b)}`}
            </option>
          ))}
        </Select>
        <Input
          name="minLevel"
          type="number"
          min={0}
          defaultValue={minLevel}
          placeholder="Min Lv"
          aria-label="Minimum level"
          className="w-24"
        />
        <Input
          name="maxLevel"
          type="number"
          min={0}
          defaultValue={maxLevel}
          placeholder="Max Lv"
          aria-label="Maximum level"
          className="w-24"
        />
      </FilterBar>

      {/* Keyed on the MI_* symbol, not id: defineObj.h reuses ids 56-59 across
          two MI_* blocks, so ids collide but keys never do. */}
      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.key || String(r.id)}
        sort={sort}
        params={params}
        unit="movers"
        empty={{ icon: Bug, message: active ? 'No movers match your filters' : 'No mover data' }}
      />
    </div>
  );
}
