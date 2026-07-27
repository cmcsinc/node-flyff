import { loadSetItems } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function SetItemsPage() {
  const data = loadSetItems();
  const sets: Array<{ name: string; count: number }> = [];

  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    for (const [key, val] of Object.entries(file)) {
      if (typeof val === "object" && val !== null) {
        sets.push({ name: String(key), count: Object.keys(val as object).length });
      }
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
            <TableHeader><TableRow><TableHead>Set Name</TableHead><TableHead>Entries</TableHead></TableRow></TableHeader>
            <TableBody>
              {sets.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="secondary">{s.count}</Badge></TableCell>
                </TableRow>
              ))}
              {sets.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-8 text-muted-foreground">No set item data</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
