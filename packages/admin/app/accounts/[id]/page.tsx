import { db } from "@/lib/db";
import { accounts, characters, inventory, inventoryItems, bank, bankItems } from "@/../drizzle/schema";
import { eq, count } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNumber, formatDate, jobName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (isNaN(accountId)) notFound();

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) notFound();

  const chars = await db.select().from(characters).where(eq(characters.accountId, accountId)).orderBy(characters.slot);

  const bankRow = await db.select().from(bank).where(eq(bank.accountId, accountId)).limit(1);
  const bankItemsList = await db.select().from(bankItems).where(eq(bankItems.accountId, accountId));

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.username}
        description={`Account ID: ${account.id}`}
        backHref="/accounts"
        actions={
          <div className="flex gap-2">
            {account.gm && <Badge variant="gold">GM</Badge>}
            {account.banned && <Badge variant="destructive">Banned</Badge>}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Email</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm">{account.email ?? "Not set"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Characters</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{chars.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Bank Gold</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatNumber(bankRow[0]?.gold ?? "0")}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Created</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm">{formatDate(account.createdAt)}</p></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="characters">
        <TabsList>
          <TabsTrigger value="characters">Characters</TabsTrigger>
          <TabsTrigger value="bank">Bank</TabsTrigger>
        </TabsList>

        <TabsContent value="characters">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slot</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>World</TableHead>
                    <TableHead>Position</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chars.map((char) => (
                    <TableRow key={char.id}>
                      <TableCell>{char.slot}</TableCell>
                      <TableCell>
                        <Link href={`/characters/${char.id}`} className="font-medium hover:underline">
                          {char.name}
                        </Link>
                      </TableCell>
                      <TableCell>{jobName(char.class)}</TableCell>
                      <TableCell>{char.level}</TableCell>
                      <TableCell>{char.worldId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {char.x.toFixed(1)}, {char.z.toFixed(1)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {chars.length === 0 && (
                    <EmptyRow colSpan={6}>No characters</EmptyRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank">
          <Card>
            <CardContent className="p-6">
              {bankRow.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Tab 0 Gold</p>
                      <p className="text-xl font-bold">{formatNumber(bankRow[0].gold)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Tab 1 Gold</p>
                      <p className="text-xl font-bold">{formatNumber(bankRow[0].goldTab1)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Tab 2 Gold</p>
                      <p className="text-xl font-bold">{formatNumber(bankRow[0].goldTab2)}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Bank Password: {bankRow[0].bankPass === "0000" ? "Not set" : "****"}
                  </p>
                  <p className="text-sm text-muted-foreground">{bankItemsList.length} items stored</p>
                </div>
              ) : (
                <p className="text-muted-foreground">No bank data</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
