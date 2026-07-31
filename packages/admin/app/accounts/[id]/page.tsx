import { db } from "@/lib/db";
import { accounts, characters, inventory, inventoryItems, bank, bankItems } from "@/../drizzle/schema";
import { eq, count } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { CharacterTable } from "./character-table";
import { formatNumber, formatDate } from "@/lib/utils";
import { EditAccountButton } from "../account-form";

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
          <div className="flex flex-wrap items-center gap-2">
            {account.gm && <Badge variant="gold">GM</Badge>}
            {account.banned && <Badge variant="destructive">Banned</Badge>}
            <EditAccountButton
              account={{
                id: account.id,
                username: account.username,
                email: account.email,
                gm: account.gm,
                banned: account.banned,
                bannedUntil: account.bannedUntil,
              }}
            />
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
              <CharacterTable rows={chars} />
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
