import { loadZones } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Map } from "lucide-react";
import { worldName } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  world?: string;
  page?: string;
  perPage?: string;
}

export default async function ZonesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const world = params.world ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadZones();

  const zones: Array<{ id: number; name: string; worldId: string; spawns: number; npcs: number }> = [];
  data.forEach((zone, i) => {
    if (typeof zone !== "object" || zone === null) return;
    const v = zone as Record<string, unknown>;
    zones.push({
      id: Number(v._id_numeric ?? v.id ?? i),
      name: String(v.name ?? v._id ?? `Zone ${i}`),
      worldId: String(v.world_id ?? v.worldId ?? "—"),
      spawns: Array.isArray(v.spawns) ? v.spawns.length : 0,
      npcs: Array.isArray(v.npcs) ? v.npcs.length : 0,
    });
  });

  zones.sort((a, b) => a.id - b.id);

  const worlds = [...new Set(zones.map((z) => z.worldId))].sort();
  const needle = search.toLowerCase();

  const filtered = zones.filter((z) => {
    if (world && z.worldId !== world) return false;
    if (needle && !z.name.toLowerCase().includes(needle) && !String(z.id).includes(needle)) return false;
    return true;
  });

  const page = paginate(filtered, parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Zones" description={`${filtered.length} of ${zones.length} zone definitions`} />

      <FilterBar perPage={perPage} active={Boolean(search || world)}>
        <SearchInput name="search" placeholder="Search by name or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Select name="world" defaultValue={world} className="w-40" aria-label="Filter by world">
          <option value="">All worlds</option>
          {worlds.map((w) => (
            <option key={w} value={w}>{worldName(w)}</option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-20">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>World</TableHead>
                  <TableHead className="text-right">Spawns</TableHead>
                  <TableHead className="text-right">NPCs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((z) => (
                  <TableRow key={z.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{z.id}</TableCell>
                    <TableCell className="font-medium">{z.name}</TableCell>
                    <TableCell><Badge variant="secondary">{worldName(z.worldId)}</Badge></TableCell>
                    <TableCell className="text-right">{z.spawns}</TableCell>
                    <TableCell className="text-right">{z.npcs}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={5}>
                    <div className="flex flex-col items-center gap-1">
                      <Map className="h-5 w-5 opacity-40" />
                      {search || world ? "No zones match your filters" : "No zone data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="zones" />
        </CardContent>
      </Card>
    </div>
  );
}
