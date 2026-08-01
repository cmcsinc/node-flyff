import { db } from "@/lib/db";
import { characters, accounts } from "@/../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHeader, TableRow, SortableHead,
} from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import { jobName, worldName } from "@/lib/utils";
import { getOnlineCharacterIds } from "@/lib/presence";
import { OnlineIndicator } from "@/components/online-indicator";
import { Swords } from "lucide-react";
import { KickAllButton } from "./kick-all-button";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  class?: string;
  sort?: string;
  dir?: string;
  /** Index signature so the whole bag can be handed to the sort/page links. */
  [key: string]: string | undefined;
}

const SORT_KEYS = [
  "id", "name", "online", "class", "level",
  "strength", "stamina", "dexterity", "intelligence", "worldId", "accountUsername",
] as const;

export default async function CharactersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const search = params.search ?? "";

  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      level: characters.level,
      class: characters.class,
      worldId: characters.worldId,
      x: characters.x,
      z: characters.z,
      strength: characters.strength,
      stamina: characters.stamina,
      dexterity: characters.dexterity,
      intelligence: characters.intelligence,
      accountId: characters.accountId,
      accountUsername: accounts.username,
    })
    .from(characters)
    .leftJoin(accounts, eq(characters.accountId, accounts.id))
    .orderBy(desc(characters.level))
    .limit(200);

  const filtered = search
    ? rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const onlineIds = await getOnlineCharacterIds();

  // Default order is the SQL level-desc, so no fallback key.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const sorted = sortRows(filtered, sort, {
    class: (r) => jobName(r.class),
    worldId: (r) => worldName(r.worldId),
    online: (r) => (onlineIds.has(r.id) ? 0 : 1),
    accountUsername: (r) => r.accountUsername ?? "",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Characters"
        description={`${filtered.length} characters`}
        // Count is every online session, not the filtered/limited table rows —
        // the drain is server-wide, so the button must not understate its reach.
        actions={<KickAllButton onlineCount={onlineIds.size} />}
      />

      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" method="GET">
        {/* Searching must not silently reset the column sort. */}
        {sort.key && <input type="hidden" name="sort" value={sort.key} />}
        {sort.key && <input type="hidden" name="dir" value={sort.dir} />}
        <SearchInput
          name="search"
          placeholder="Search by name…"
          defaultValue={search}
          className="w-full sm:w-64"
        />
        <Button type="submit" variant="secondary" className="w-full sm:w-auto">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="id" sort={sort} params={params} className="w-16">ID</SortableHead>
                  <SortableHead sortKey="name" sort={sort} params={params}>Name</SortableHead>
                  <SortableHead sortKey="online" sort={sort} params={params} className="w-28">Status</SortableHead>
                  <SortableHead sortKey="class" sort={sort} params={params}>Class</SortableHead>
                  <SortableHead sortKey="level" sort={sort} params={params} align="right">Level</SortableHead>
                  <SortableHead sortKey="strength" sort={sort} params={params} align="right" className="hidden md:table-cell">STR</SortableHead>
                  <SortableHead sortKey="stamina" sort={sort} params={params} align="right" className="hidden md:table-cell">STA</SortableHead>
                  <SortableHead sortKey="dexterity" sort={sort} params={params} align="right" className="hidden md:table-cell">DEX</SortableHead>
                  <SortableHead sortKey="intelligence" sort={sort} params={params} align="right" className="hidden md:table-cell">INT</SortableHead>
                  <SortableHead sortKey="worldId" sort={sort} params={params} className="hidden lg:table-cell">World</SortableHead>
                  <SortableHead sortKey="accountUsername" sort={sort} params={params} className="hidden sm:table-cell">Account</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((char) => (
                  <TableRow key={char.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{char.id}</TableCell>
                    <TableCell>
                      <Link href={`/characters/${char.id}`} className="font-medium text-primary hover:underline">
                        {char.name}
                      </Link>
                      {/* Columns hidden on small screens fold into the name cell. */}
                      <span className="block text-xs text-muted-foreground lg:hidden">
                        {worldName(char.worldId)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <OnlineIndicator online={onlineIds.has(char.id)} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{jobName(char.class)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold text-gold">{char.level}</TableCell>
                    <TableCell className="hidden text-right md:table-cell">{char.strength}</TableCell>
                    <TableCell className="hidden text-right md:table-cell">{char.stamina}</TableCell>
                    <TableCell className="hidden text-right md:table-cell">{char.dexterity}</TableCell>
                    <TableCell className="hidden text-right md:table-cell">{char.intelligence}</TableCell>
                    <TableCell className="hidden lg:table-cell">{worldName(char.worldId)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Link href={`/accounts/${char.accountId}`} className="text-xs text-muted-foreground hover:text-primary hover:underline">
                        {char.accountUsername}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={11}>
                    <div className="flex flex-col items-center gap-1">
                      <Swords className="h-5 w-5 opacity-40" />
                      No characters found
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
