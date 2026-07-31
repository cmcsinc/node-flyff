import { loadNpcs, loadZoneRefs } from "@/lib/npcs";
import { loadMovers } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHead } from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import Link from "next/link";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  zone?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
};

/** mover id → display name, so the table shows "Dr. Estern" not just 220. */
function moverNames(): Map<number, string> {
  const names = new Map<number, string>();
  for (const doc of loadMovers()) {
    const entries = doc.movers;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      names.set(Number(v.id ?? 0), String(v.name ?? v.key ?? "?"));
    }
  }
  return names;
}

const SORT_KEYS = ["id", "zoneName", "characterKey", "mover", "x", "functions"] as const;

export default async function NpcsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const zone = params.zone ?? "";
  const perPage = parsePerPage(params.perPage);

  const npcs = loadNpcs();
  const zones = loadZoneRefs();
  const names = moverNames();
  const needle = search.toLowerCase();

  const filtered = npcs.filter((n) => {
    if (zone && n.zoneId !== zone) return false;
    if (!needle) return true;
    const mover = names.get(n.moverId) ?? "";
    return (
      n.characterKey.toLowerCase().includes(needle) ||
      mover.toLowerCase().includes(needle) ||
      String(n.moverId).includes(needle) ||
      String(n.id).includes(needle)
    );
  });

  filtered.sort((a, b) => a.zoneId.localeCompare(b.zoneId) || a.id - b.id);
  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort, { mover: (n) => names.get(n.moverId) ?? "" }), parsePage(params.page), perPage);
  const newZone = zone || zones[0]?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="NPCs"
        description={`${filtered.length} of ${npcs.length} placements across ${zones.length} zones`}
        actions={
          newZone ? (
            <Link
              href={`/resources/npcs/${encodeURIComponent(`${newZone}:new`)}/edit`}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Add NPC
            </Link>
          ) : undefined
        }
      />

      <FilterBar perPage={perPage} sort={sort} active={Boolean(search || zone)}>
        <SearchInput name="search" placeholder="Search by character key, mover, or ID..." defaultValue={search} className="w-full sm:w-80" />
        <Select name="zone" defaultValue={zone} className="w-44" aria-label="Filter by zone">
          <option value="">All zones</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="id" sort={sort} params={params} className="w-16">ID</SortableHead>
                  <SortableHead sortKey="zoneName" sort={sort} params={params}>Zone</SortableHead>
                  <SortableHead sortKey="characterKey" sort={sort} params={params}>Character Key</SortableHead>
                  <SortableHead sortKey="mover" sort={sort} params={params}>Mover</SortableHead>
                  <SortableHead sortKey="x" sort={sort} params={params}>Position</SortableHead>
                  <SortableHead sortKey="functions" sort={sort} params={params} align="right">Functions</SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((n) => (
                  <TableRow key={n.ref}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{n.id}</TableCell>
                    <TableCell><Badge variant="secondary">{n.zoneName}</Badge></TableCell>
                    <TableCell className="font-medium">{n.characterKey || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {names.get(n.moverId) ?? "?"}
                      <span className="ml-1 font-mono text-muted-foreground">#{n.moverId}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {n.x.toFixed(0)}, {n.y.toFixed(0)}, {n.z.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right">{n.functions}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/resources/npcs/${encodeURIComponent(n.ref)}/edit`} className="text-xs text-primary hover:underline">Edit</Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7}>
                    <div className="flex flex-col items-center gap-1">
                      <Users className="h-5 w-5 opacity-40" />
                      {search || zone ? "No NPCs match your filters" : "No NPC placements"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="NPCs" />
        </CardContent>
      </Card>
    </div>
  );
}
