import { loadItems } from "@/lib/resources";
import { getIk3Label } from "@/lib/game-constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const data = loadItems();

  // YAML structure: { _kind, items: [{ id, name, item_kind3, ... }] }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Items</h1>
        <p className="text-muted-foreground">{items.length} items from {data.length} resource files</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 500).map((item) => (
                  <TableRow key={`${item.file}-${item.id}`}>
                    <TableCell className="font-mono text-xs">{item.id}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell><Badge variant="secondary">{item.kind}</Badge></TableCell>
                    <TableCell>
                      <Link href={`/resources/items/${item.id}/edit`} className="text-xs text-primary hover:underline">Edit</Link>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length > 500 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                      Showing 500 of {items.length} items
                    </TableCell>
                  </TableRow>
                )}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      No item data found in resources/data/items/
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
