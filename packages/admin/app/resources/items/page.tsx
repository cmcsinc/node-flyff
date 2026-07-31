import { loadItems } from "@/lib/resources";
import { getIk3Label } from "@/lib/game-constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHead,
} from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import Link from "next/link";
import { Package } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  kind?: string;
  file?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["id", "name", "kind", "file"] as const;

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const kind = params.kind ?? "";
  const file = params.file ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadItems();

  const items: Array<{ id: number; name: string; kindSym: string; kind: string; file: string }> = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const fileKind = String(doc._kind ?? "unknown");
    const entries = (doc as Record<string, unknown>).items;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const rawKind = String(v.item_kind3 ?? v.item_kind2 ?? "");
      items.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        kindSym: rawKind,
        kind: rawKind ? getIk3Label(rawKind) : "—",
        file: fileKind,
      });
    }
  }

  items.sort((a, b) => a.id - b.id);

  const kinds = [...new Set(items.map((i) => i.kindSym).filter(Boolean))].sort();
  const files = [...new Set(items.map((i) => i.file))].sort();

  const needle = search.toLowerCase();
  const filtered = items.filter((i) => {
    if (kind && i.kindSym !== kind) return false;
    if (file && i.file !== file) return false;
    if (needle && !i.name.toLowerCase().includes(needle) && !String(i.id).includes(needle)) return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Items" description={`${filtered.length} of ${items.length} items from ${data.length} resource files`} />

      <FilterBar perPage={perPage} sort={sort} active={Boolean(search || kind || file)}>
        <SearchInput name="search" placeholder="Search by name or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Select name="kind" defaultValue={kind} className="w-44" aria-label="Filter by item kind">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{getIk3Label(k)}</option>
          ))}
        </Select>
        <Select name="file" defaultValue={file} className="w-36" aria-label="Filter by resource file">
          <option value="">All files</option>
          {files.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="id" sort={sort} params={params} className="w-20">ID</SortableHead>
                  <SortableHead sortKey="name" sort={sort} params={params}>Name</SortableHead>
                  <SortableHead sortKey="kind" sort={sort} params={params}>Kind</SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((item) => (
                  <TableRow key={`${item.file}-${item.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.id}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell><Badge variant="secondary">{item.kind}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Link href={`/resources/items/${item.id}/edit`} className="text-xs text-primary hover:underline">
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={4}>
                    <div className="flex flex-col items-center gap-1">
                      <Package className="h-5 w-5 opacity-40" />
                      {search || kind || file ? "No items match your filters" : "No item data found in resources/data/items/"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="items" />
        </CardContent>
      </Card>
    </div>
  );
}
