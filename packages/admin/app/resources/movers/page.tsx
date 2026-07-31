import { loadMovers } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHead } from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import Link from "next/link";
import { Bug } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  type?: string;
  minLevel?: string;
  maxLevel?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["id", "name", "kind", "type", "level"] as const;

export default async function MoversPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const type = params.type ?? "";
  const minLevel = params.minLevel ?? "";
  const maxLevel = params.maxLevel ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadMovers();

  const movers: Array<{ id: number; name: string; kind: string; type: string; level: number }> = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const entries = (doc as Record<string, unknown>).movers;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      movers.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        kind: String(v.key ?? v.dwKind ?? "—"),
        type: String(v.type ?? "—"),
        level: Number(v.level ?? 0),
      });
    }
  }

  movers.sort((a, b) => a.id - b.id);

  const types = [...new Set(movers.map((m) => m.type))].sort();
  const min = Number(minLevel);
  const max = Number(maxLevel);
  const needle = search.toLowerCase();

  const filtered = movers.filter((m) => {
    if (type && m.type !== type) return false;
    if (Number.isFinite(min) && minLevel && m.level < min) return false;
    if (Number.isFinite(max) && maxLevel && m.level > max) return false;
    if (needle && !m.name.toLowerCase().includes(needle) && !String(m.id).includes(needle) && !m.kind.toLowerCase().includes(needle)) return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Movers" description={`${filtered.length} of ${movers.length} movers from ${data.length} files`} />

      <FilterBar perPage={perPage} sort={sort} active={Boolean(search || type || minLevel || maxLevel)}>
        <SearchInput name="search" placeholder="Search by name, key, or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Select name="type" defaultValue={type} className="w-36" aria-label="Filter by mover type">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="id" sort={sort} params={params} className="w-20">ID</SortableHead>
                  <SortableHead sortKey="name" sort={sort} params={params}>Name</SortableHead>
                  <SortableHead sortKey="kind" sort={sort} params={params}>Key</SortableHead>
                  <SortableHead sortKey="type" sort={sort} params={params}>Type</SortableHead>
                  <SortableHead sortKey="level" sort={sort} params={params} align="right">Level</SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* ponytail: key on the MI symbol, not id -- defineObj.h reuses 56-59
                    across two MI_* blocks so ids collide. Upgrade: dedupe the converter
                    output so ids are unique, then key on m.id. */}
                {page.rows.map((m) => (
                  <TableRow key={m.kind}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.id}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.kind}</TableCell>
                    <TableCell><Badge variant="secondary">{m.type}</Badge></TableCell>
                    <TableCell className="text-right">{m.level > 0 ? m.level : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/resources/movers/${m.id}/edit`} className="text-xs text-primary hover:underline">Edit</Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={6}>
                    <div className="flex flex-col items-center gap-1">
                      <Bug className="h-5 w-5 opacity-40" />
                      {search || type || minLevel || maxLevel ? "No movers match your filters" : "No mover data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="movers" />
        </CardContent>
      </Card>
    </div>
  );
}
