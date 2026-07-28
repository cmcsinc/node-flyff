import { loadMovers } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Bug } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function MoversPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadMovers();

  const movers: Array<{ id: number; name: string; kind: string }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const entries = (file as Record<string, unknown>).movers;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      movers.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        kind: String(v.key ?? v.dwKind ?? "—"),
      });
    }
  }

  movers.sort((a, b) => a.id - b.id);

  const filtered = search
    ? movers.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) || String(m.id).includes(search))
    : movers;

  const MAX = 500;
  const capped = filtered.slice(0, MAX);

  return (
    <div className="space-y-6">
      <PageHeader title="Movers" description={`${filtered.length} of ${movers.length} movers from ${data.length} files`} />

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
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {capped.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.id}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell><Badge variant="secondary">{m.kind}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Link href={`/resources/movers/${m.id}/edit`} className="text-xs text-primary hover:underline">Edit</Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={4}>
                    <div className="flex flex-col items-center gap-1">
                      <Bug className="h-5 w-5 opacity-40" />
                      {search ? "No movers match your search" : "No mover data"}
                    </div>
                  </EmptyRow>
                )}
                {filtered.length > MAX && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                      Showing {MAX} of {filtered.length} movers — refine your search to see more
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
