import { loadDrops } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gem } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function DropsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadDrops();

  const allDrops: Array<{ key: string; gold: string; count: number }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const entries = (file as Record<string, unknown>).drops;
    if (!Array.isArray(entries)) continue;
    for (const d of entries) {
      if (typeof d !== "object" || d === null) continue;
      const v = d as Record<string, unknown>;
      const gold = v.gold as Record<string, unknown> | undefined;
      allDrops.push({
        key: String(v.key ?? "?"),
        gold: gold ? `${gold.min ?? 0}–${gold.max ?? 0}` : "—",
        count: Array.isArray(v.items) ? v.items.length : 0,
      });
    }
  }

  allDrops.sort((a, b) => a.key.localeCompare(b.key));

  const filtered = search
    ? allDrops.filter((d) => d.key.toLowerCase().includes(search.toLowerCase()))
    : allDrops;

  const MAX = 500;
  const capped = filtered.slice(0, MAX);

  return (
    <div className="space-y-6">
      <PageHeader title="Drops" description={`${filtered.length} of ${allDrops.length} drop definitions from ${data.length} files`} />

      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search by mover key..." defaultValue={search} className="w-full sm:w-72" />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Mover Key</TableHead>
                  <TableHead>Gold</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {capped.map((d) => (
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
                      {search ? "No drops match your search" : "No drop data"}
                    </div>
                  </EmptyRow>
                )}
                {filtered.length > MAX && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-3 text-center text-xs text-muted-foreground">
                      Showing {MAX} of {filtered.length} drops — refine your search to see more
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
