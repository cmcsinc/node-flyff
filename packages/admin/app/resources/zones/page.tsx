import type * as React from 'react';
import { zoneRows } from '@/lib/resource-rows';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import { IdCell, NameWithSymbol, TagCell, CountCell, EditLink } from '@/components/resource-cells';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { Map } from 'lucide-react';
import { worldName } from '@/lib/utils';
import type { ZoneRow } from '@/lib/resource-rows';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  world?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ['id', 'name', 'world', 'spawns', 'npcs'] as const;

const COLUMNS: readonly ResourceColumn<ZoneRow>[] = [
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
    cell: (r) => <NameWithSymbol name={r.name} symbol={r.slug} />,
  },
  {
    key: 'world',
    header: 'World',
    sortable: true,
    cell: (r) => <TagCell label={r.world} title={r.worldId} />,
  },
  {
    key: 'spawns',
    header: 'Spawns',
    sortable: true,
    align: 'right',
    cell: (r) => <CountCell value={r.spawns} />,
  },
  {
    key: 'npcs',
    header: 'NPCs',
    sortable: true,
    align: 'right',
    cell: (r) => <CountCell value={r.npcs} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    // Metadata only — the spawn/NPC collections in the same file have their own
    // pages, reachable from the zone editor's header.
    cell: (r) => (
      <EditLink
        href={`/resources/zones/${encodeURIComponent(r.slug)}/edit`}
        label={`zone ${r.slug}`}
      />
    ),
  },
];

export default async function ZonesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const world = params.world ?? '';
  const perPage = parsePerPage(params.perPage);

  const zones = zoneRows();
  const worlds = [...new Set(zones.map((z) => z.worldId).filter(Boolean))].sort();
  const needle = search.toLowerCase();

  const filtered = zones.filter((z) => {
    if (world && z.worldId !== world) return false;
    if (
      needle &&
      !z.name.toLowerCase().includes(needle) &&
      !z.slug.toLowerCase().includes(needle) &&
      !String(z.id).includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || world);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zones"
        description={`${filtered.length.toLocaleString()} of ${zones.length.toLocaleString()} zone definitions`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by name, slug, or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Select name="world" defaultValue={world} className="w-40" aria-label="Filter by world">
          <option value="">All worlds</option>
          {worlds.map((w) => (
            <option key={w} value={w}>
              {worldName(w)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.slug || String(r.id)}
        sort={sort}
        params={params}
        unit="zones"
        empty={{ icon: Map, message: active ? 'No zones match your filters' : 'No zone data' }}
      />
    </div>
  );
}
