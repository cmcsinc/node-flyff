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
                  const entries = typeof file === "object" && file !== null ? Object.keys(file).length : 0;
                  const name = typeof file === "object" && file !== null ? Object.keys(file)[0] : `file-${i}`;
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell><Badge variant="secondary">{entries}</Badge></TableCell>
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
