import { db } from "@/lib/db";
import { accounts, characters } from "@/../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHead,
} from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import { formatDate } from "@/lib/utils";
import { BanToggleButton } from "./actions";
import { CreateAccountButton } from "./account-form";
import { AUTH, AUTH_LABELS, hasAuthority } from "@flyff/entities/constants/authority";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  filter?: string;
  sort?: string;
  dir?: string;
  /** Index signature so the whole bag can be handed to the sort/page links. */
  [key: string]: string | undefined;
}

const SORT_KEYS = ["id", "username", "email", "charCount", "status", "createdAt"] as const;

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
      authority: accounts.authority,
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
    if (filter === "gm" && !hasAuthority(r.authority, AUTH.GAMEMASTER)) return false;
    if (filter === "banned" && !r.banned) return false;
    return true;
  });

  // Default order is newest-first (the SQL `ORDER BY`), so no fallback sort key.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const sorted = sortRows(filtered, sort, {
    charCount: (r) => Number(r.charCount),
    createdAt: (r) => r.createdAt,
    // "Status" is three mutually exclusive badges; rank them rather than sorting
    // by a column that doesn't exist: banned → GM → active.
    status: (r) => (r.banned ? 0 : hasAuthority(r.authority, AUTH.GAMEMASTER) ? 1 : 2),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description={`${filtered.length} of ${rows.length} accounts`}
        actions={<CreateAccountButton />}
      />

      {/* Filters */}
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" method="GET">
        {/* Filtering must not silently reset the column sort. */}
        {sort.key && <input type="hidden" name="sort" value={sort.key} />}
        {sort.key && <input type="hidden" name="dir" value={sort.dir} />}
        <SearchInput
          name="search"
          placeholder="Search username…"
          defaultValue={search}
          className="w-full sm:w-64"
        />
        <Select name="filter" defaultValue={filter} aria-label="Filter accounts" className="w-full sm:w-44">
          <option value="all">All Accounts</option>
          <option value="gm">Staff Only</option>
          <option value="banned">Banned Only</option>
        </Select>
        <Button type="submit" variant="secondary" className="w-full sm:w-auto">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="id" sort={sort} params={params} className="w-16">ID</SortableHead>
                  <SortableHead sortKey="username" sort={sort} params={params}>Username</SortableHead>
                  <SortableHead sortKey="email" sort={sort} params={params} className="hidden md:table-cell">Email</SortableHead>
                  <SortableHead sortKey="charCount" sort={sort} params={params} align="center" className="hidden sm:table-cell">Characters</SortableHead>
                  <SortableHead sortKey="status" sort={sort} params={params}>Status</SortableHead>
                  <SortableHead sortKey="createdAt" sort={sort} params={params} className="hidden lg:table-cell">Created</SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{acc.id}</TableCell>
                    <TableCell>
                      <Link href={`/accounts/${acc.id}`} className="font-medium text-primary hover:underline">
                        {acc.username}
                      </Link>
                      {/* Email/char-count fold in here below md. */}
                      <span className="block truncate text-xs text-muted-foreground md:hidden">
                        {acc.email ?? "no email"} · {acc.charCount} chars
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{acc.email ?? "—"}</TableCell>
                    <TableCell className="hidden text-center sm:table-cell">{acc.charCount}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {hasAuthority(acc.authority, AUTH.GAMEMASTER) && (
                          <Badge variant="gold">{AUTH_LABELS[acc.authority] ?? "Staff"}</Badge>
                        )}
                        {acc.banned && <Badge variant="destructive">Banned</Badge>}
                        {!hasAuthority(acc.authority, AUTH.GAMEMASTER) && !acc.banned && (
                          <Badge variant="success">Active</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDate(acc.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <BanToggleButton id={acc.id} banned={acc.banned} />
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
