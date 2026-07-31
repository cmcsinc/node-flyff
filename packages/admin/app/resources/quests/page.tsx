import { loadQuests } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollText } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  npc?: string;
  minLevel?: string;
  maxLevel?: string;
  page?: string;
  perPage?: string;
}

/** First argument value of the named quest command, or "" when absent. */
function firstArg(cmds: unknown[], name: string): string {
  const cmd = cmds.find(
    (c): c is Record<string, unknown> =>
      typeof c === "object" && c !== null && (c as Record<string, unknown>).cmd === name,
  );
  if (!cmd || !Array.isArray(cmd.args) || cmd.args.length === 0) return "";
  const arg = cmd.args[0] as Record<string, unknown>;
  return String(arg.value ?? "");
}

export default async function QuestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const npc = params.npc ?? "";
  const minLevel = params.minLevel ?? "";
  const maxLevel = params.maxLevel ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadQuests();

  const quests: Array<{ id: number; title: string; level: number; npc: string; cmds: number }> = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const v = doc as Record<string, unknown>;
    const cmds = Array.isArray(v.commands) ? v.commands : [];
    const id = Number(v.id ?? 0);
    quests.push({
      id,
      title: String(v.symbol ?? `Quest ${id}`),
      level: Number(firstArg(cmds, "SetBeginCondLevel") || 0),
      npc: firstArg(cmds, "SetCharacter"),
      cmds: cmds.length,
    });
  }

  quests.sort((a, b) => a.id - b.id);

  const min = Number(minLevel);
  const max = Number(maxLevel);
  const needle = search.toLowerCase();
  const npcNeedle = npc.toLowerCase();

  const filtered = quests.filter((q) => {
    if (minLevel && Number.isFinite(min) && q.level < min) return false;
    if (maxLevel && Number.isFinite(max) && q.level > max) return false;
    if (npcNeedle && !q.npc.toLowerCase().includes(npcNeedle)) return false;
    if (needle && !q.title.toLowerCase().includes(needle) && !String(q.id).includes(needle)) return false;
    return true;
  });

  const page = paginate(filtered, parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Quests" description={`${filtered.length} of ${quests.length} quest definitions`} />

      <FilterBar perPage={perPage} active={Boolean(search || npc || minLevel || maxLevel)}>
        <SearchInput name="search" placeholder="Search by title or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Input name="npc" defaultValue={npc} placeholder="NPC key" aria-label="Filter by NPC character key" className="w-40" />
        <Input name="minLevel" type="number" min={0} defaultValue={minLevel} placeholder="Min Lv" aria-label="Minimum level" className="w-24" />
        <Input name="maxLevel" type="number" min={0} defaultValue={maxLevel} placeholder="Max Lv" aria-label="Maximum level" className="w-24" />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-20">ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>NPC</TableHead>
                  <TableHead>Commands</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{q.id}</TableCell>
                    <TableCell className="font-medium">{q.title}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{q.npc || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{q.cmds > 0 ? `${q.cmds} cmds` : "—"}</TableCell>
                    <TableCell className="text-right">{q.level > 0 ? <Badge variant="secondary">Lv. {q.level}</Badge> : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/resources/quests/${String(q.id)}/edit`}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={6}>
                    <div className="flex flex-col items-center gap-1">
                      <ScrollText className="h-5 w-5 opacity-40" />
                      {search || npc || minLevel || maxLevel ? "No quests match your filters" : "No quest data found"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="quests" />
        </CardContent>
      </Card>
    </div>
  );
}
