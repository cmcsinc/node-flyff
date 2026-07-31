import type * as React from "react";
import { dropRows } from "@/lib/resource-rows";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { ResourceTable, type ResourceColumn } from "@/components/resource-table";
import { IdCell, NameWithSymbol, NumCell, CountCell, Dash } from "@/components/resource-cells";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { parseSort, sortRows, type QueryParams } from "@/lib/sort";
import { Gem } from "lucide-react";
import type { DropRow } from "@/lib/resource-rows";

export const dynamic = "force-dynamic";

interface SearchParams extends QueryParams {
  search?: string;
  itemId?: string;
  minItems?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["key", "moverName", "modelIdx", "goldMin", "goldMax", "maxItem", "count"] as const;

const COLUMNS: readonly ResourceColumn<DropRow>[] = [
  {
    key: "modelIdx",
    header: "Model",
    sortable: true,
    className: "w-20",
    cell: (r) => <IdCell value={r.modelIdx} />,
  },
  {
    key: "moverName",
    header: "Monster",
    sortable: true,
    cell: (r) => <NameWithSymbol name={r.moverName} symbol={r.key} />,
  },
  {
    key: "goldMin",
    header: "Penya",
    sortable: true,
    align: "right",
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
    key: "maxItem",
    header: "Max drops",
    sortable: true,
    align: "right",
    cell: (r) => <NumCell value={r.maxItem} />,
  },
  {
    key: "count",
    header: "Entries",
    sortable: true,
    align: "right",
    cell: (r) => <CountCell value={r.count} />,
  },
];

export default async function DropsPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? "";
  const itemId = params.itemId ?? "";
  const minItems = params.minItems ?? "";
  const perPage = parsePerPage(params.perPage);

  const drops = dropRows();
  const wantId = Number(itemId);
  const minCount = Number(minItems);
  const needle = search.toLowerCase();

  const filtered = drops.filter((d) => {
    if (itemId && Number.isFinite(wantId) && !d.itemIds.includes(wantId)) return false;
    if (minItems && Number.isFinite(minCount) && d.count < minCount) return false;
    // Search spans the resolved monster name as well as the MI_* key, so a GM
    // can type "Aibatt" without knowing the symbol.
    if (needle && !d.key.toLowerCase().includes(needle) && !d.moverName.toLowerCase().includes(needle))
      return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || itemId || minItems);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drops"
        description={`${filtered.length.toLocaleString()} of ${drops.length.toLocaleString()} drop tables`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by monster name or MI_ key..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Input
          name="itemId"
          type="number"
          min={0}
          defaultValue={itemId}
          placeholder="Drops item ID"
          aria-label="Filter by dropped item ID"
          className="w-36"
        />
        <Input
          name="minItems"
          type="number"
          min={0}
          defaultValue={minItems}
          placeholder="Min entries"
          aria-label="Minimum drop entry count"
          className="w-32"
        />
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.key}
        sort={sort}
        params={params}
        unit="drop tables"
        empty={{ icon: Gem, message: active ? "No drop tables match your filters" : "No drop data" }}
      />
    </div>
  );
}
