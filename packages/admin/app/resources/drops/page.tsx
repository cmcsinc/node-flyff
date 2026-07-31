import { loadDrops } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHead } from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import { Gem } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  itemId?: string;
  minItems?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["key", "gold", "count"] as const;

export default async function DropsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const itemId = params.itemId ?? "";
  const minItems = params.minItems ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadDrops();

  const allDrops: Array<{ key: string; gold: string; count: number; itemIds: number[] }> = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const entries = (doc as Record<string, unknown>).drops;
    if (!Array.isArray(entries)) continue;
    for (const d of entries) {
      if (typeof d !== "object" || d === null) continue;
      const v = d as Record<string, unknown>;
      const gold = v.gold as Record<string, unknown> | undefined;
      const items = Array.isArray(v.items) ? v.items : [];
      allDrops.push({
        key: String(v.key ?? "?"),
        gold: gold ? `${gold.min ?? 0}–${gold.max ?? 0}` : "—",
        count: items.length,
        itemIds: items.map((i) => Number((i as Record<string, unknown>)?.itemId ?? 0)),
      });
    }
  }

  allDrops.sort((a, b) => a.key.localeCompare(b.key));

  const wantId = Number(itemId);
  const minCount = Number(minItems);
  const needle = search.toLowerCase();

  const filtered = allDrops.filter((d) => {
    if (itemId && Number.isFinite(wantId) && !d.itemIds.includes(wantId)) return false;
    if (minItems && Number.isFinite(minCount) && d.count < minCount) return false;
    if (needle && !d.key.toLowerCase().includes(needle)) return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(
    sortRows(filtered, sort, { gold: (d) => Number(d.gold.split("–")[0]) || 0 }),
    parsePage(params.page),
    perPage,
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Drops" description={`${filtered.length} of ${allDrops.length} drop definitions from ${data.length} files`} />

      <FilterBar perPage={perPage} sort={sort} active={Boolean(search || itemId || minItems)}>
        <SearchInput name="search" placeholder="Search by mover key..." defaultValue={search} className="w-full sm:w-72" />
        <Input name="itemId" type="number" min={0} defaultValue={itemId} placeholder="Drops item ID" aria-label="Filter by dropped item ID" className="w-36" />
        <Input name="minItems" type="number" min={0} defaultValue={minItems} placeholder="Min items" aria-label="Minimum item count" className="w-28" />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="key" sort={sort} params={params}>Mover Key</SortableHead>
                  <SortableHead sortKey="gold" sort={sort} params={params}>Gold</SortableHead>
                  <SortableHead sortKey="count" sort={sort} params={params} align="right">Items</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="font-mono text-xs">{d.key}</TableCell>
                    <TableCell className="text-muted-foreground">{d.gold}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{d.count}</Badge></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={3}>
                    <div className="flex flex-col items-center gap-1">
                      <Gem className="h-5 w-5 opacity-40" />
                      {search || itemId || minItems ? "No drops match your filters" : "No drop data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="drops" />
        </CardContent>
      </Card>
    </div>
  );
}
