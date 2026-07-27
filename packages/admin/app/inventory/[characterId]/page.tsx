import { db } from "@/lib/db";
import { characters, inventory, inventoryItems } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
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
      <div className="flex items-center gap-3">
        <Link href={`/characters/${charId}`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{char.name} — Inventory</h1>
          <p className="text-muted-foreground">
            Level {char.level} &middot; {items.length} items
          </p>
        </div>
      </div>

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Item ID</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Refine</TableHead>
                <TableHead>Element</TableHead>
                <TableHead>Durability</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.slot}</TableCell>
                  <TableCell className="font-medium">{item.itemId}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.refine > 0 ? `+${item.refine}` : "—"}</TableCell>
                  <TableCell>{item.element > 0 ? `${item.element}/${item.elementLevel}` : "—"}</TableCell>
                  <TableCell>{item.durability === -1 ? "∞" : item.durability}</TableCell>
                  <TableCell><Badge variant="outline">{item.flags}</Badge></TableCell>
                  <TableCell><ItemActions characterId={charId} slot={item.slot} /></TableCell>
                </TableRow>
              ))}
              {equipItems.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nothing equipped</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bag Slots */}
      <Card>
        <CardHeader>
          <CardTitle>Bag (slots 0–41)</CardTitle>
          <CardDescription>{bagItems.length} items in bag</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Item ID</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Refine</TableHead>
                <TableHead>Element</TableHead>
                <TableHead>Durability</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bagItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.slot}</TableCell>
                  <TableCell className="font-medium">{item.itemId}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.refine > 0 ? `+${item.refine}` : "—"}</TableCell>
                  <TableCell>{item.element > 0 ? `${item.element}/${item.elementLevel}` : "—"}</TableCell>
                  <TableCell>{item.durability === -1 ? "∞" : item.durability}</TableCell>
                  <TableCell><Badge variant="outline">{item.flags}</Badge></TableCell>
                  <TableCell><ItemActions characterId={charId} slot={item.slot} /></TableCell>
                </TableRow>
              ))}
              {bagItems.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Bag is empty</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
