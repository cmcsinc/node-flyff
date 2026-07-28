import { loadSetItems } from "@/lib/resources";
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

export default async function SetItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadSetItems();

  const sets: Array<{ name: string; id: number; pieces: number; bonuses: number }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const entries = (file as Record<string, unknown>).sets;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      sets.push({
        name: String(v.nameId ?? `Set ${v.id}`),
        id: Number(v.id ?? 0),
        pieces: Array.isArray(v.elems) ? v.elems.length : 0,
        bonuses: Array.isArray(v.avails) ? v.avails.length : 0,
      });
    }
  }

  sets.sort((a, b) => a.id - b.id);

  const filtered = search
    ? sets.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || String(s.id).includes(search))
    : sets;

  return (
    <div className="space-y-6">
      <PageHeader title="Set Items" description={`${filtered.length} set definitions`} />

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
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Bonuses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
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
                      {search ? "No sets match your search" : "No set item data"}
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
