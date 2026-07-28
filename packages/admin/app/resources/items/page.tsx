import { loadItems } from "@/lib/resources";
import { getIk3Label } from "@/lib/game-constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { Package } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadItems();

  const items: Array<{ id: number; name: string; kind: string; file: string }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const kind = String(file._kind ?? "unknown");
    const entries = (file as Record<string, unknown>).items;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const rawKind = String(v.item_kind3 ?? v.item_kind2 ?? "");
      items.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        kind: rawKind ? getIk3Label(rawKind) : "—",
        file: kind,
      });
    }
  }

  items.sort((a, b) => a.id - b.id);

  const filtered = search
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()) || String(i.id).includes(search))
    : items;

  const MAX = 500;
  const capped = filtered.slice(0, MAX);

  return (
    <div className="space-y-6">
      <PageHeader title="Items" description={`${filtered.length} of ${items.length} items from ${data.length} resource files`} />

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
                {capped.map((item) => (
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
                      {search ? "No items match your search" : "No item data found in resources/data/items/"}
                    </div>
                  </EmptyRow>
                )}
                {filtered.length > MAX && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                      Showing {MAX} of {filtered.length} items — refine your search to see more
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
