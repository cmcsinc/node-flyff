import { db } from "@/lib/db";
import { accounts, bank, bankItems } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { BankGoldEditor } from "./actions";

export const dynamic = "force-dynamic";

export default async function BankPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const accId = Number(accountId);
  if (isNaN(accId)) notFound();

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accId)).limit(1);
  if (!account) notFound();

  const bankRow = await db.select().from(bank).where(eq(bank.accountId, accId)).limit(1);
  const items = await db
    .select()
    .from(bankItems)
    .where(eq(bankItems.accountId, accId))
    .orderBy(bankItems.tab, bankItems.slot);

  const tabItems = [0, 1, 2].map((t) => items.filter((i) => i.tab === t));
  const tabGolds = [
    Number(bankRow[0]?.gold ?? 0),
    Number(bankRow[0]?.goldTab1 ?? 0),
    Number(bankRow[0]?.goldTab2 ?? 0),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${account.username} — Bank`}
        description={`${items.length} items across 3 tabs · Password: ${bankRow[0]?.bankPass === "0000" ? "Not set" : "****"}`}
        backHref={`/accounts/${accId}`}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Bank Gold by Tab</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((t) => (
              <BankGoldEditor key={t} accountId={accId} tab={t} currentGold={tabGolds[t]} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="tab0">
        <TabsList>
          <TabsTrigger value="tab0">Tab 0 ({tabItems[0].length})</TabsTrigger>
          <TabsTrigger value="tab1">Tab 1 ({tabItems[1].length})</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2 ({tabItems[2].length})</TabsTrigger>
        </TabsList>

        {[0, 1, 2].map((t) => (
          <TabsContent key={t} value={`tab${t}`}>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Slot</TableHead>
                      <TableHead>Item ID</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Refine</TableHead>
                      <TableHead>Durability</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tabItems[t].map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.slot}</TableCell>
                        <TableCell className="font-medium">{item.itemId}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>{item.refine > 0 ? `+${item.refine}` : "—"}</TableCell>
                        <TableCell>{item.durability === -1 ? "∞" : item.durability}</TableCell>
                      </TableRow>
                    ))}
                    {tabItems[t].length === 0 && (
                      <EmptyRow colSpan={5}>Empty tab</EmptyRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
