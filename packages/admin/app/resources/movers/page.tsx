import { loadMovers } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MoversPage() {
  const data = loadMovers();
  // YAML structure: { movers: [{ id, key, name, ... }] }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Movers</h1>
        <p className="text-muted-foreground">{movers.length} movers from {data.length} files</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow><TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {movers.slice(0, 500).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.id}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell><Badge variant="secondary">{m.kind}</Badge></TableCell>
                    <TableCell><Link href={`/resources/movers/${m.id}/edit`} className="text-xs text-primary hover:underline">Edit</Link></TableCell>
                  </TableRow>
                ))}
                {movers.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No mover data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
