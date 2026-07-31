import { loadQuests } from "@/lib/resources";
import { getResourceIndex } from "@/lib/resource-cache";
import { npcNameForKey } from "@flyff/resources";
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
import { Pencil, ScrollText } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

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

  // `title` in the yml is an `IDS_PROPQUEST_INC_*` token, not text — the C++
  // resolves it through `propQuest.txt.txt` at load (`ProjectCmn.cpp:985`), and
  // so does the client. Resolve it here so the table shows what a player sees.
  // Of 474 quests: 464 resolve, 10 have a token whose table entry is an empty
  // string, so the display falls back to `—` rather than a blank cell.
  //
  // `SetCharacter` likewise stores a character.inc block key (`MaFl_Rin`), not a
  // name. `npcNameForKey` follows the C++ chain (`Project.cpp:3023` ->
  // `Mover.cpp:1011`): block -> `SetName(IDS_*)` -> `character.txt.txt`. The
  // propMover name is the shared *model* name and is wrong for NPCs, so an
  // unresolved key falls back to the de-prefixed key, never the model name.
  const { questText, characterInc } = await getResourceIndex();

  const quests: {
    id: number;
    title: string;
    titleToken: string;
    symbol: string;
    level: number;
    npcKey: string;
    npcName: string;
  }[] = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const v = doc as Record<string, unknown>;
    const cmds = Array.isArray(v.commands) ? v.commands : [];
    const id = Number(v.id ?? 0);
    const symbol = typeof v.symbol === "string" ? v.symbol : `Quest ${String(id)}`;
    const titleToken = typeof v.title === "string" ? v.title : "";
    const npcKey = firstArg(cmds, "SetCharacter");
    quests.push({
      id,
      title: questText.get(titleToken) ?? "",
      titleToken,
      symbol,
      level: Number(firstArg(cmds, "SetBeginCondLevel") || 0),
      npcKey,
      npcName: npcNameForKey(characterInc, npcKey) ?? "",
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
    // The NPC filter matches the resolved name as well as the key, so typing
    // "Rin" works without knowing the `MaFl_` prefix.
    if (
      npcNeedle &&
      !q.npcKey.toLowerCase().includes(npcNeedle) &&
      !q.npcName.toLowerCase().includes(npcNeedle)
    )
      return false;
    // Search spans the resolved title, the symbol, the token, and the id — a GM
    // cross-referencing the C++ has only the symbol or token to go on.
    if (
      needle &&
      !q.title.toLowerCase().includes(needle) &&
      !q.symbol.toLowerCase().includes(needle) &&
      !q.titleToken.toLowerCase().includes(needle) &&
      !String(q.id).includes(needle)
    )
      return false;
    return true;
  });

  const page = paginate(filtered, parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Quests" description={`${filtered.length} of ${quests.length} quest definitions`} />

      <FilterBar perPage={perPage} active={Boolean(search || npc || minLevel || maxLevel)}>
        <SearchInput name="search" placeholder="Search title, symbol, token, or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Input name="npc" defaultValue={npc} placeholder="NPC name or key" aria-label="Filter by NPC name or character key" className="w-40" />
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
                  <TableHead>Symbol</TableHead>
                  <TableHead>Title ID</TableHead>
                  <TableHead>NPC</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{q.id}</TableCell>
                    <TableCell className="font-medium">
                      {q.title || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{q.symbol}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {/* Trimmed of its shared prefix; the full token is in the tooltip. */}
                      {q.titleToken ? (
                        <span title={q.titleToken}>{q.titleToken.replace(/^IDS_PROPQUEST_INC_/, "")}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {q.npcKey ? (
                        <>
                          {q.npcName || (
                            /* Unresolved: show the key de-prefixed rather than the
                               propMover model name, which is wrong for NPCs. */
                            <span className="text-muted-foreground">
                              {q.npcKey.replace(/^[A-Za-z]{2,4}_/, "")}
                            </span>
                          )}
                          <span className="ml-1 font-mono text-muted-foreground">({q.npcKey})</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{q.level > 0 ? <Badge variant="secondary">Lv. {q.level}</Badge> : "—"}</TableCell>
                    <TableCell className="text-right">
                      {/*
                        Button styling on a Link, not a Button: this navigates, so
                        it must stay an anchor (middle-click, open-in-new-tab,
                        keyboard). `Button` renders a bare <button> with no
                        asChild, so the variant classes are applied directly.
                      */}
                      <Link
                        href={`/resources/quests/${String(q.id)}/edit`}
                        aria-label={`Edit quest ${String(q.id)}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7}>
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
