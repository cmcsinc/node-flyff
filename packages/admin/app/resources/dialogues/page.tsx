import type * as React from 'react';
import { dialogueRows } from '@/lib/resource-rows';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { FilterBar } from '@/components/filter-bar';
import { ResourceTable, type ResourceColumn } from '@/components/resource-table';
import { NameWithSymbol, CountCell, NumCell, EditLink } from '@/components/resource-cells';
import { parsePage, parsePerPage, paginate } from '@/lib/paginate';
import { parseSort, sortRows, type QueryParams } from '@/lib/sort';
import { MessageSquareText } from 'lucide-react';
import type { DialogueRow } from '@/lib/resource-rows';

export const dynamic = 'force-dynamic';

interface SearchParams extends QueryParams {
  search?: string;
  minStates?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ['npcName', 'prefix', 'states', 'inert'] as const;

const COLUMNS: readonly ResourceColumn<DialogueRow>[] = [
  {
    key: 'npcName',
    header: 'NPC',
    sortable: true,
    cell: (r) => <NameWithSymbol name={r.npcName} symbol={r.prefix} />,
  },
  {
    key: 'states',
    header: 'States',
    sortable: true,
    align: 'right',
    cell: (r) => <CountCell value={r.states} />,
  },
  {
    key: 'inert',
    header: 'Inert',
    sortable: true,
    align: 'right',
    // States the dialogue runtime cannot act on — the porting backlog for this
    // NPC. A plain figure, not a chip: it is a number to sort by, and a chip
    // beside the States chip would make two competing emphases in one row.
    cell: (r) => <NumCell value={r.inert} />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (r) => (
      <EditLink
        href={`/resources/dialogues/${encodeURIComponent(r.prefix)}/edit`}
        label={`dialogue ${r.prefix}`}
      />
    ),
  },
];

export default async function DialoguesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? '';
  const minStates = params.minStates ?? '';
  const perPage = parsePerPage(params.perPage);

  const rows = await dialogueRows();
  const minS = Number(minStates);
  const needle = search.toLowerCase();

  const filtered = rows.filter((r) => {
    if (minStates && Number.isFinite(minS) && r.states < minS) return false;
    // Search spans the resolved NPC name as well as the file stem.
    if (
      needle &&
      !r.prefix.toLowerCase().includes(needle) &&
      !r.npcName.toLowerCase().includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(
    sortRows(filtered, sort, { npcName: (r) => r.npcName || r.prefix }),
    parsePage(params.page),
    perPage,
  );
  const active = Boolean(search || minStates);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dialogues"
        description={`${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} NPC dialogue files`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by NPC name or file stem..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Input
          name="minStates"
          type="number"
          min={0}
          defaultValue={minStates}
          placeholder="Min states"
          aria-label="Minimum state count"
          className="w-32"
        />
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.ref}
        sort={sort}
        params={params}
        unit="dialogues"
        empty={{
          icon: MessageSquareText,
          message: active ? 'No dialogues match your filters' : 'No dialogue data',
        }}
      />
    </div>
  );
}
