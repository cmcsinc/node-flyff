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
import { formatNumber, jobName } from "@/lib/utils";
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

  return (
    <div className="space-y-6">
      <PageHeader title="Characters" description={`${filtered.length} characters`} />

      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search by name..." defaultValue={search} className="w-full sm:w-64" />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                  <TableHead className="text-right">STR</TableHead>
                  <TableHead className="text-right">STA</TableHead>
                  <TableHead className="text-right">DEX</TableHead>
                  <TableHead className="text-right">INT</TableHead>
                  <TableHead>World</TableHead>
                  <TableHead>Account</TableHead>
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
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{jobName(char.class)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold text-gold">{char.level}</TableCell>
                    <TableCell className="text-right">{char.strength}</TableCell>
                    <TableCell className="text-right">{char.stamina}</TableCell>
                    <TableCell className="text-right">{char.dexterity}</TableCell>
                    <TableCell className="text-right">{char.intelligence}</TableCell>
                    <TableCell>{char.worldId}</TableCell>
                    <TableCell>
                      <Link href={`/accounts/${char.accountId}`} className="text-xs text-muted-foreground hover:text-primary hover:underline">
                        {char.accountUsername}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={10}>
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
