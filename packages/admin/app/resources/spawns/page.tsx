import type * as React from 'react';
import { loadSpawns } from '@/lib/spawns';
import { loadZoneRefs } from '@/lib/zone-seq';
import { getResourceIndex } from '@/lib/resource-cache';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import {
  IdCell,
  NameWithSymbol,
  TagCell,
  PosCell,
  NumCell,
  EditLink,
} from '@/components/resource-cells';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import Link from 'next/link';
import { Plus, Bug } from 'lucide-react';
import type { SpawnRow } from '@/lib/spawns';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  zone?: string;
  minLevel?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = [
  'id',
  'zoneName',
  'moverName',
  'level',
  'count',
  'radius',
  'delay',
  'x',
] as const;

const COLUMNS: readonly ResourceColumn<SpawnRow>[] = [
  {
    key: 'id',
    header: 'ID',
    sortable: true,
    className: 'w-16',
    cell: (r) => <IdCell value={r.id} />,
  },
  { key: 'zoneName', header: 'Zone', sortable: true, cell: (r) => <TagCell label={r.zoneName} /> },
  {
    key: 'moverName',
    header: 'Monster',
    sortable: true,
    cell: (r) => <NameWithSymbol name={r.moverName} symbol={`#${String(r.moverId)}`} />,
  },
  {
    key: 'level',
    header: 'Lv',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.level} />,
  },
  {
    key: 'count',
    header: 'Count',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={r.count} />,
  },
  {
    key: 'radius',
    header: 'Radius',
    sortable: true,
    align: 'right',
    cell: (r) => <NumCell value={Math.round(r.radius)} />,
  },
  {
    key: 'delay',
    header: 'Respawn (s)',
    sortable: true,
    align: 'right',
    // Seconds, not the raw ms: 55000 reads as noise, 55 reads as a rate.
    cell: (r) => <NumCell value={Math.round(r.delay / 1000)} />,
  },
  {
    key: 'x',
    header: 'Position',
    sortable: true,
    cell: (r) => <PosCell x={r.x} y={r.y} z={r.z} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (r) => (
      <EditLink
        href={`/resources/spawns/${encodeURIComponent(r.ref)}/edit`}
        label={`spawn ${String(r.id)} in ${r.zoneName}`}
      />
    ),
  },
];

export default async function SpawnsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const zone = params.zone ?? '';
  const minLevel = params.minLevel ?? '';
  const perPage = parsePerPage(params.perPage);

  const zones = loadZoneRefs();
  const idx = await getResourceIndex();
  const spawns = loadSpawns(idx.movers.movers);

  const minL = Number(minLevel);
  const needle = search.toLowerCase();
  const filtered = spawns.filter((s) => {
    if (zone && s.zoneId !== zone) return false;
    if (minLevel && Number.isFinite(minL) && s.level < minL) return false;
    if (!needle) return true;
    return (
      s.moverName.toLowerCase().includes(needle) ||
      String(s.moverId).includes(needle) ||
      String(s.id).includes(needle)
    );
  });

  filtered.sort((a, b) => a.zoneId.localeCompare(b.zoneId) || a.id - b.id);
  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const newZone = zone || zones[0]?.id;
  const active = Boolean(search || zone || minLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spawns"
        description={`${filtered.length.toLocaleString()} of ${spawns.length.toLocaleString()} spawn points across ${String(zones.length)} zones`}
        actions={
          newZone ? (
            <Link
              href={`/resources/spawns/${encodeURIComponent(`${newZone}:new`)}/edit`}
              className={buttonVariants({ size: 'sm' })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add spawn
            </Link>
          ) : undefined
        }
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by monster name or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Select name="zone" defaultValue={zone} className="w-44" aria-label="Filter by zone">
          <option value="">All zones</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
        <Input
          name="minLevel"
          type="number"
          min={0}
          defaultValue={minLevel}
          placeholder="Min level"
          aria-label="Minimum monster level"
          className="w-32"
        />
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.ref}
        sort={sort}
        params={params}
        unit="spawns"
        empty={{ icon: Bug, message: active ? 'No spawns match your filters' : 'No spawn points' }}
      />
    </div>
  );
}
