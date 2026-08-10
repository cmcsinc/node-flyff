import { db } from '@/lib/db';
import { characters, inventory, inventoryItems } from '@/../drizzle/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { formatNumber, jobName, worldName } from '@/lib/utils';
import { getIk3Label } from '@/lib/game-constants';
import { getItem, getAllItems, itemIconUrl } from '@/lib/item-catalog';
import { InventoryExplorer } from './inventory-explorer';
import { GoldEditor } from './actions';
import type { PickerItem, SlotItem } from './types';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}): Promise<React.JSX.Element> {
  const { characterId } = await params;
  const charId = Number(characterId);
  if (isNaN(charId)) notFound();

  const char = (await db.select().from(characters).where(eq(characters.id, charId)).limit(1)).at(0);
  if (!char) notFound();

  const invRow = await db
    .select()
    .from(inventory)
    .where(eq(inventory.characterId, charId))
    .limit(1);
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.characterId, charId))
    .orderBy(inventoryItems.slot);

  // Resolve each inventory row into a rich, serializable SlotItem for the client.
  const slotItems: SlotItem[] = [];
  for (const r of rows) {
    const def = await getItem(r.itemId);
    slotItems.push({
      id: r.id,
      slot: r.slot,
      itemId: r.itemId,
      quantity: r.quantity,
      refine: r.refine,
      element: r.element,
      elementLevel: r.elementLevel,
      durability: r.durability,
      flags: r.flags,
      name: def?.name ?? `Item #${String(r.itemId)}`,
      iconUrl: itemIconUrl(def?.icon),
      category: def?.item_kind3 ? getIk3Label(def.item_kind3) : 'Unknown',
      kind2: def?.item_kind2 ?? '',
      rarity: def?.rarity,
      attackMin: def?.attack_min,
      attackMax: def?.attack_max,
      defense: def?.defense,
      defenseMax: def?.defense_max,
      magicDefense: def?.magic_defense,
      hitRate: def?.hit_rate,
      parry: def?.parry,
      effects: def?.effects,
      levelReq: def?.level_req,
      jobReq: def?.job_req,
      genderReq: def?.gender_req,
      price: def?.price,
      stackSize: def?.stack_size,
      twoHanded: def?.two_handed,
    });
  }

  // Lightweight picker list for the "Add item" control.
  const allItems = await getAllItems();
  const pickerItems: PickerItem[] = allItems
    .filter((it) => it.icon)
    .map((it) => ({
      id: it.id,
      name: it.name,
      iconUrl: itemIconUrl(it.icon),
      category: it.item_kind3 ? getIk3Label(it.item_kind3) : '',
      stackSize: it.stack_size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const bagItems = slotItems.filter((i) => i.slot < 42);
  const equipItems = slotItems.filter((i) => i.slot >= 42);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${char.name} — Inventory`}
        description={`Level ${String(char.level)} ${jobName(char.class)} · ${worldName(char.worldId)} · ${String(slotItems.length)} items`}
        backHref={`/characters/${String(charId)}`}
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {bagItems.length} in bag · {equipItems.length} equipped ·{' '}
            {formatNumber(invRow[0]?.gold ?? '0')} penya
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equipment &amp; Bag</CardTitle>
          <CardDescription>Hover an item to see its stats. Click × to remove.</CardDescription>
        </CardHeader>
        <CardContent>
          <InventoryExplorer
            characterId={charId}
            bagItems={bagItems}
            equipItems={equipItems}
            pickerItems={pickerItems}
          />
        </CardContent>
      </Card>
    </div>
  );
}
