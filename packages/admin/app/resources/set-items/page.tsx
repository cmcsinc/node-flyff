import { loadSetItems } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gem } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  itemId?: string;
  minPieces?: string;
  page?: string;
  perPage?: string;
}

export default async function SetItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const itemId = params.itemId ?? "";
  const minPieces = params.minPieces ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadSetItems();

  const sets: Array<{ name: string; id: number; pieces: number; bonuses: number; itemIds: number[] }> = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const entries = (doc as Record<string, unknown>).sets;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const elems = Array.isArray(v.elems) ? v.elems : [];
      sets.push({
        name: String(v.nameId ?? `Set ${v.id}`),
        id: Number(v.id ?? 0),
        pieces: elems.length,
        bonuses: Array.isArray(v.avails) ? v.avails.length : 0,
        itemIds: elems.map((e) => Number((e as Record<string, unknown>)?.itemId ?? 0)),
      });
    }
  }

  sets.sort((a, b) => a.id - b.id);

  const wantId = Number(itemId);
  const minP = Number(minPieces);
  const needle = search.toLowerCase();

  const filtered = sets.filter((s) => {
    if (itemId && Number.isFinite(wantId) && !s.itemIds.includes(wantId)) return false;
    if (minPieces && Number.isFinite(minP) && s.pieces < minP) return false;
    if (needle && !s.name.toLowerCase().includes(needle) && !String(s.id).includes(needle)) return false;
    return true;
  });

  const page = paginate(filtered, parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Set Items" description={`${filtered.length} of ${sets.length} set definitions`} />

      <FilterBar perPage={perPage} active={Boolean(search || itemId || minPieces)}>
        <SearchInput name="search" placeholder="Search by name or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Input name="itemId" type="number" min={0} defaultValue={itemId} placeholder="Contains item ID" aria-label="Filter by member item ID" className="w-40" />
        <Input name="minPieces" type="number" min={0} defaultValue={minPieces} placeholder="Min pieces" aria-label="Minimum piece count" className="w-32" />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-20">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Bonuses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.id}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{s.pieces}</Badge></TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{s.bonuses}</Badge></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={4}>
                    <div className="flex flex-col items-center gap-1">
                      <Gem className="h-5 w-5 opacity-40" />
                      {search || itemId || minPieces ? "No sets match your filters" : "No set item data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="sets" />
        </CardContent>
      </Card>
    </div>
  );
}
