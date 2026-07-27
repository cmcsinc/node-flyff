import { db } from "@/lib/db";
import { characters, accounts } from "@/../drizzle/schema";
import { eq, desc, like, sql } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNumber, jobName } from "@/lib/utils";

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Characters</h1>
        <p className="text-muted-foreground">{filtered.length} characters</p>
      </div>

      <form className="flex gap-3" method="GET">
        <input
          name="search"
          placeholder="Search by name..."
          defaultValue={search}
          className="flex h-9 w-64 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 py-1 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Search
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>STR</TableHead>
                <TableHead>STA</TableHead>
                <TableHead>DEX</TableHead>
                <TableHead>INT</TableHead>
                <TableHead>World</TableHead>
                <TableHead>Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((char) => (
                <TableRow key={char.id}>
                  <TableCell className="font-mono text-xs">{char.id}</TableCell>
                  <TableCell>
                    <Link href={`/characters/${char.id}`} className="font-medium hover:underline">
                      {char.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{jobName(char.class)}</Badge>
                  </TableCell>
                  <TableCell className="font-bold">{char.level}</TableCell>
                  <TableCell>{char.strength}</TableCell>
                  <TableCell>{char.stamina}</TableCell>
                  <TableCell>{char.dexterity}</TableCell>
                  <TableCell>{char.intelligence}</TableCell>
                  <TableCell>{char.worldId}</TableCell>
                  <TableCell>
                    <Link href={`/accounts/${char.accountId}`} className="text-muted-foreground hover:underline text-xs">
                      {char.accountUsername}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No characters found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
