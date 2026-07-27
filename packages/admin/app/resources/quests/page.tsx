import { loadQuests } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function QuestsPage() {
  const data = loadQuests();

  // YAML structure: each file IS a quest { id, symbol, commands, states, quest_items }
  const quests: Array<{ id: number; title: string; level: number; type: string }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const v = file as Record<string, unknown>;
    const id = Number(v.id ?? 0);
    // Extract level from SetBeginCondLevel command args if present
    let level = 0;
    const cmds = Array.isArray(v.commands) ? v.commands : [];
    const lvlCmd = cmds.find((c: Record<string, unknown>) => c.cmd === "SetBeginCondLevel");
    if (lvlCmd && Array.isArray((lvlCmd as Record<string, unknown>).args)) {
      const args = (lvlCmd as Record<string, unknown>).args as Array<Record<string, unknown>>;
      if (args.length > 0) level = Number(args[0].value ?? 0);
    }
    quests.push({
      id,
      title: String(v.symbol ?? `Quest ${id}`),
      level,
      type: cmds.length > 0 ? `${cmds.length} cmds` : "—",
    });
  }

  quests.sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quests</h1>
        <p className="text-muted-foreground">{quests.length} quest definitions from {data.length} files</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quests.slice(0, 500).map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">{q.id}</TableCell>
                    <TableCell className="font-medium">{q.title}</TableCell>
                    <TableCell>{q.level > 0 ? <Badge variant="secondary">Lv. {q.level}</Badge> : "—"}</TableCell>
                  </TableRow>
                ))}
                {quests.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      No quest data found
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
