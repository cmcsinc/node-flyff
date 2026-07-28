import { loadQuests } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function QuestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadQuests();

  const quests: Array<{ id: number; title: string; level: number; type: string }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const v = file as Record<string, unknown>;
    const id = Number(v.id ?? 0);
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

  const filtered = search
    ? quests.filter((q) => q.title.toLowerCase().includes(search.toLowerCase()) || String(q.id).includes(search))
    : quests;

  return (
    <div className="space-y-6">
      <PageHeader title="Quests" description={`${filtered.length} quest definitions from ${data.length} files`} />

      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search by title or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-20">ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Commands</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{q.id}</TableCell>
                    <TableCell className="font-medium">{q.title}</TableCell>
                    <TableCell className="text-muted-foreground">{q.type}</TableCell>
                    <TableCell className="text-right">{q.level > 0 ? <Badge variant="secondary">Lv. {q.level}</Badge> : "—"}</TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={4}>{search ? "No quests match your search" : "No quest data found"}</EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
