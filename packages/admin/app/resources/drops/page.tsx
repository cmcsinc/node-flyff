import { loadDrops } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function DropsPage() {
  const data = loadDrops();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Drops</h1>
        <p className="text-muted-foreground">{data.length} drop definition files</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow><TableHead>Mover Key</TableHead><TableHead>Gold</TableHead><TableHead>Drops</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
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
                  return allDrops.slice(0, 300).map((d) => (
                    <TableRow key={d.key}>
                      <TableCell className="font-mono text-xs">{d.key}</TableCell>
                      <TableCell>{d.gold}</TableCell>
                      <TableCell><Badge variant="secondary">{d.count}</Badge></TableCell>
                    </TableRow>
                  ));
                })()}
                {data.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No drop data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
