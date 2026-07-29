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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNumber, jobName, worldName } from "@/lib/utils";
import { getOnlineCharacterIds } from "@/lib/presence";
import { OnlineIndicator } from "@/components/online-indicator";
import { Swords } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  class?: string;
}

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

  return (
    <div className="space-y-6">
      <PageHeader title="Characters" description={`${filtered.length} characters`} />

      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" method="GET">
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
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                  <TableHead className="hidden text-right md:table-cell">STR</TableHead>
                  <TableHead className="hidden text-right md:table-cell">STA</TableHead>
                  <TableHead className="hidden text-right md:table-cell">DEX</TableHead>
                  <TableHead className="hidden text-right md:table-cell">INT</TableHead>
                  <TableHead className="hidden lg:table-cell">World</TableHead>
                  <TableHead className="hidden sm:table-cell">Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((char) => (
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
