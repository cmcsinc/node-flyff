import { loadZones } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Map } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function ZonesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadZones();

  const zones: Array<{ id: number; name: string; worldId: string; description: string }> = [];
  data.forEach((zone, i) => {
    if (typeof zone !== "object" || zone === null) return;
    const v = zone as Record<string, unknown>;
    zones.push({
      id: Number(v.id ?? v.worldId ?? i),
      name: String(v.name ?? v.worldId ?? `Zone ${i}`),
      worldId: String(v.worldId ?? "—"),
      description: String(v.description ?? ""),
    });
  });

  const filtered = search
    ? zones.filter((z) => z.name.toLowerCase().includes(search.toLowerCase()) || String(z.id).includes(search))
    : zones;

  return (
    <div className="space-y-6">
      <PageHeader title="Zones" description={`${filtered.length} of ${zones.length} zone definitions`} />

      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search by name or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-20">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>World</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((z) => (
                  <TableRow key={z.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{z.id}</TableCell>
                    <TableCell className="font-medium">{z.name}</TableCell>
                    <TableCell><Badge variant="secondary">{z.worldId}</Badge></TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">{z.description || "—"}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={4}>
                    <div className="flex flex-col items-center gap-1">
                      <Map className="h-5 w-5 opacity-40" />
                      {search ? "No zones match your search" : "No zone data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
