import type * as React from "react";
import { setItemRows } from "@/lib/resource-rows";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { ResourceTable, type ResourceColumn } from "@/components/resource-table";
import { IdCell, NameCell, SymbolCell, CountCell } from "@/components/resource-cells";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { parseSort, sortRows, type QueryParams } from "@/lib/sort";
import { Gem } from "lucide-react";
import type { SetItemRow } from "@/lib/resource-rows";

export const dynamic = "force-dynamic";

interface SearchParams extends QueryParams {
  search?: string;
  itemId?: string;
  minPieces?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["id", "name", "nameId", "pieces", "bonuses"] as const;

const COLUMNS: readonly ResourceColumn<SetItemRow>[] = [
  { key: "id", header: "ID", sortable: true, className: "w-20", cell: (r) => <IdCell value={r.id} /> },
  { key: "name", header: "Name", sortable: true, cell: (r) => <NameCell value={r.name} /> },
  {
    key: "nameId",
    header: "Name ID",
    sortable: true,
    // Trimmed of its shared prefix; the full token is in the tooltip.
    cell: (r) => (
      <SymbolCell value={r.nameId.replace(/^IDS_PROPITEMETC_INC_/, "")} title={r.nameId} />
    ),
  },
  {
    key: "pieces",
    header: "Pieces",
    sortable: true,
    align: "right",
    cell: (r) => <CountCell value={r.pieces} />,
  },
  {
    key: "bonuses",
    header: "Bonuses",
    sortable: true,
    align: "right",
    cell: (r) => <CountCell value={r.bonuses} />,
  },
];

export default async function SetItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? "";
  const itemId = params.itemId ?? "";
  const minPieces = params.minPieces ?? "";
  const perPage = parsePerPage(params.perPage);

  const sets = setItemRows();
  const wantId = Number(itemId);
  const minP = Number(minPieces);
  const needle = search.toLowerCase();

  const filtered = sets.filter((s) => {
    if (itemId && Number.isFinite(wantId) && !s.itemIds.includes(wantId)) return false;
    if (minPieces && Number.isFinite(minP) && s.pieces < minP) return false;
    // The token is searchable too — a GM cross-referencing propItemEtc.inc has
    // only the IDS_* token to go on.
    if (
      needle &&
      !s.name.toLowerCase().includes(needle) &&
      !s.nameId.toLowerCase().includes(needle) &&
      !String(s.id).includes(needle)
    )
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || itemId || minPieces);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Set Items"
        description={`${filtered.length.toLocaleString()} of ${sets.length.toLocaleString()} set definitions`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by name, token, or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Input
          name="itemId"
          type="number"
          min={0}
          defaultValue={itemId}
          placeholder="Contains item ID"
          aria-label="Filter by member item ID"
          className="w-40"
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
        empty={{ icon: Gem, message: active ? "No sets match your filters" : "No set item data" }}
      />
    </div>
  );
}
