import { loadItems } from "@/lib/resources";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const data = loadItems();

  // Flatten item entries from all YAML files
  const items: Array<{ id: number; name: string; kind: string; file: string }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    for (const [key, val] of Object.entries(file)) {
      if (typeof val === "object" && val !== null && "dwID" in val) {
        const v = val as Record<string, unknown>;
        items.push({
          id: Number(v.dwID ?? 0),
          name: String(v.szName ?? key),
          kind: String(v.szKind ?? v.dwItemKind3 ?? "—"),
          file: key,
        });
      }
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 500).map((item) => (
                  <TableRow key={`${item.file}-${item.id}`}>
                    <TableCell className="font-mono text-xs">{item.id}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell><Badge variant="secondary">{item.kind}</Badge></TableCell>
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
