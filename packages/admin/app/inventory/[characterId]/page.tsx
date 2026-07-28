import { db } from "@/lib/db";
import { characters, inventory, inventoryItems } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { GoldEditor, ItemActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function InventoryPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const charId = Number(characterId);
  if (isNaN(charId)) notFound();

  const [char] = await db.select().from(characters).where(eq(characters.id, charId)).limit(1);
  if (!char) notFound();

  const invRow = await db.select().from(inventory).where(eq(inventory.characterId, charId)).limit(1);
  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.characterId, charId))
    .orderBy(inventoryItems.slot);

  const bagItems = items.filter((i) => i.slot < 42);
  const equipItems = items.filter((i) => i.slot >= 42);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${char.name} — Inventory`}
        description={`Level ${char.level} · ${items.length} items`}
        backHref={`/characters/${charId}`}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Carried Gold (Penya)</CardTitle>
          </CardHeader>
          <CardContent>
            <GoldEditor characterId={charId} currentGold={Number(invRow[0]?.gold ?? 0)} />
          </CardContent>
        </Card>
      </div>

      {/* Equipment Slots */}
      <Card>
        <CardHeader>
          <CardTitle>Equipment (slots 42+)</CardTitle>
          <CardDescription>{equipItems.length} equipped items</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Slot</TableHead>
                  <TableHead>Item ID</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Refine</TableHead>
                  <TableHead>Element</TableHead>
                  <TableHead>Durability</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.slot}</TableCell>
                    <TableCell className="font-medium">{item.itemId}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell>{item.refine > 0 ? `+${item.refine}` : "—"}</TableCell>
                    <TableCell>{item.element > 0 ? `${item.element}/${item.elementLevel}` : "—"}</TableCell>
                    <TableCell>{item.durability === -1 ? "∞" : item.durability}</TableCell>
                    <TableCell><Badge variant="outline">{item.flags}</Badge></TableCell>
                    <TableCell className="text-right"><ItemActions characterId={charId} slot={item.slot} /></TableCell>
                  </TableRow>
                ))}
                {equipItems.length === 0 && (
                  <EmptyRow colSpan={8}>Nothing equipped</EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bag Slots */}
      <Card>
        <CardHeader>
          <CardTitle>Bag (slots 0–41)</CardTitle>
          <CardDescription>{bagItems.length} items in bag</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Slot</TableHead>
                  <TableHead>Item ID</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Refine</TableHead>
                  <TableHead>Element</TableHead>
                  <TableHead>Durability</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bagItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.slot}</TableCell>
                    <TableCell className="font-medium">{item.itemId}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell>{item.refine > 0 ? `+${item.refine}` : "—"}</TableCell>
                    <TableCell>{item.element > 0 ? `${item.element}/${item.elementLevel}` : "—"}</TableCell>
                    <TableCell>{item.durability === -1 ? "∞" : item.durability}</TableCell>
                    <TableCell><Badge variant="outline">{item.flags}</Badge></TableCell>
                    <TableCell className="text-right"><ItemActions characterId={charId} slot={item.slot} /></TableCell>
                  </TableRow>
                ))}
                {bagItems.length === 0 && (
                  <EmptyRow colSpan={8}>Bag is empty</EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
