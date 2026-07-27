import { loadSetItems } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function SetItemsPage() {
  const data = loadSetItems();
  // YAML structure: { sets: [{ id, elems, avails }] }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Set Items</h1>
        <p className="text-muted-foreground">{sets.length} set definitions</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Pieces</TableHead><TableHead>Bonuses</TableHead></TableRow></TableHeader>
            <TableBody>
              {sets.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.id}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="secondary">{s.pieces}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{s.bonuses}</Badge></TableCell>
                </TableRow>
              ))}
              {sets.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No set item data</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
