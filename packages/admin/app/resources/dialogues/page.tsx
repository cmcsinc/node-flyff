import { loadDialogues } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function DialoguesPage() {
  const data = loadDialogues();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dialogues</h1>
        <p className="text-muted-foreground">{data.length} dialogue files</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow><TableHead>NPC / File</TableHead><TableHead>Entries</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.map((file, i) => {
                  if (typeof file !== "object" || file === null) return null;
                  const v = file as Record<string, unknown>;
                  const prefix = String(v.prefix ?? "");
                  const states = typeof v.states === "object" && v.states !== null ? Object.keys(v.states as object).length : 0;
                  if (!prefix) return null;
                  return (
                    <TableRow key={prefix}>
                      <TableCell className="font-mono text-xs">{prefix}</TableCell>
                      <TableCell><Badge variant="secondary">{states} states</Badge></TableCell>
                    </TableRow>
                  );
                })}
                {data.length === 0 && (
                  <TableRow><TableCell colSpan={2} className="text-center py-8 text-muted-foreground">No dialogue data</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
