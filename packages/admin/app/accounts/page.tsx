import { db } from "@/lib/db";
import { accounts, characters } from "@/../drizzle/schema";
import { count, eq, like, desc, sql } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { BanToggleButton, GmToggleButton } from "./actions";
import { Search, Filter } from "lucide-react";

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

  let query = db
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
    .limit(100)
    .$dynamic();

  const rows = await query;

  const filtered = rows.filter((r) => {
    if (search && !r.username.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "gm" && !r.gm) return false;
    if (filter === "banned" && !r.banned) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground">{filtered.length} accounts</p>
        </div>
      </div>

      {/* Filters */}
      <form className="flex gap-2 items-center" method="GET">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="search"
            placeholder="Search username..."
            defaultValue={search}
            className="pl-8 h-9 w-64"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <select
            name="filter"
            defaultValue={filter}
            className="h-9 rounded-md border border-input bg-transparent pl-8 pr-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All Accounts</option>
            <option value="gm">GM Only</option>
            <option value="banned">Banned Only</option>
          </select>
        </div>
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
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Characters</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell className="font-mono text-xs">{acc.id}</TableCell>
                  <TableCell>
                    <Link href={`/accounts/${acc.id}`} className="font-medium hover:underline">
                      {acc.username}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{acc.email ?? "—"}</TableCell>
                  <TableCell>{acc.charCount}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {acc.gm && <Badge variant="default">GM</Badge>}
                      {acc.banned && <Badge variant="destructive">Banned</Badge>}
                      {!acc.gm && !acc.banned && <Badge variant="secondary">Active</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{formatDate(acc.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <BanToggleButton id={acc.id} banned={acc.banned} />
                      <GmToggleButton id={acc.id} gm={acc.gm} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No accounts found
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
