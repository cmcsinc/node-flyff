import { db } from "@/lib/db";
import { accounts, characters } from "@/../drizzle/schema";
import { count, eq, desc, sql } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { BanToggleButton, GmToggleButton } from "./actions";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  filter?: string;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const search = params.search ?? "";
  const filter = params.filter ?? "all";

  const rows = await db
    .select({
      id: accounts.id,
      username: accounts.username,
      email: accounts.email,
      gm: accounts.gm,
      banned: accounts.banned,
      bannedUntil: accounts.bannedUntil,
      createdAt: accounts.createdAt,
      charCount: sql<number>`count(${characters.id})`.as("char_count"),
    })
    .from(accounts)
    .leftJoin(characters, eq(accounts.id, characters.accountId))
    .groupBy(accounts.id)
    .orderBy(desc(accounts.createdAt))
    .limit(100);

  const filtered = rows.filter((r) => {
    if (search && !r.username.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "gm" && !r.gm) return false;
    if (filter === "banned" && !r.banned) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Accounts" description={`${filtered.length} of ${rows.length} accounts`} />

      {/* Filters */}
      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search username..." defaultValue={search} className="w-full sm:w-64" />
        <Select name="filter" defaultValue={filter} className="w-full sm:w-44">
          <option value="all">All Accounts</option>
          <option value="gm">GM Only</option>
          <option value="banned">Banned Only</option>
        </Select>
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-center">Characters</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{acc.id}</TableCell>
                    <TableCell>
                      <Link href={`/accounts/${acc.id}`} className="font-medium text-primary hover:underline">
                        {acc.username}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{acc.email ?? "—"}</TableCell>
                    <TableCell className="text-center">{acc.charCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {acc.gm && <Badge variant="gold">GM</Badge>}
                        {acc.banned && <Badge variant="destructive">Banned</Badge>}
                        {!acc.gm && !acc.banned && <Badge variant="success">Active</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(acc.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <BanToggleButton id={acc.id} banned={acc.banned} />
                        <GmToggleButton id={acc.id} gm={acc.gm} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7}>
                    <div className="flex flex-col items-center gap-1">
                      <Users className="h-5 w-5 opacity-40" />
                      No accounts found
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
