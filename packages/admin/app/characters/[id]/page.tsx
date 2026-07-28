import { db } from "@/lib/db";
import { characters, accounts, inventory, inventoryItems, skills, characterQuests, characterCompletedQuests } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyRow } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNumber, jobName, worldName } from "@/lib/utils";
import { getIk3Label } from "@/lib/game-constants";
import { getItem, itemIconUrl } from "@/lib/item-catalog";
import { getSkill, skillIconUrl } from "@/lib/skill-catalog";
import { InventoryExplorer } from "../../inventory/[characterId]/inventory-explorer";
import type { SlotItem } from "../../inventory/[characterId]/types";
import type { SkillSlotItem } from "./skills/types";
import { SkillExplorer } from "./skills/skill-explorer";
import { EditStatsForm } from "./edit-stats";

export const dynamic = "force-dynamic";

export default async function CharacterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const charId = Number(id);
  if (isNaN(charId)) notFound();

  const [char] = await db.select().from(characters).where(eq(characters.id, charId)).limit(1);
  if (!char) notFound();

  const [account] = await db.select().from(accounts).where(eq(accounts.id, char.accountId)).limit(1);
  const invItems = await db.select().from(inventoryItems).where(eq(inventoryItems.characterId, charId));
  const invRow = await db.select().from(inventory).where(eq(inventory.characterId, charId)).limit(1);
  const charSkills = await db.select().from(skills).where(eq(skills.characterId, charId));
  const activeQuests = await db.select().from(characterQuests).where(eq(characterQuests.characterId, charId));
  const completedQuests = await db.select().from(characterCompletedQuests).where(eq(characterCompletedQuests.characterId, charId));

  const resolvedInv = await resolveSlotItems(invItems);
  const resolvedSkills = await resolveSkills(charSkills);

  return (
    <div className="space-y-6">
      <PageHeader
        title={char.name}
        description={`${jobName(char.class)} · Level ${char.level} · ${worldName(char.worldId)}`}
        backHref="/characters"
        actions={
          account ? (
            <Link href={`/accounts/${account.id}`}>
              <Badge variant="secondary">Account: {account.username}</Badge>
            </Link>
          ) : undefined
        }
      />

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="card-top-accent">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Level / EXP</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">Lv. {char.level}</p><p className="text-xs text-muted-foreground">{formatNumber(char.exp)} exp</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">HP / MP</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{char.hp} / {char.maxHp} HP</p><p className="text-sm">{char.mp} / {char.maxMp} MP</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Stats</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <span>STR: {char.strength}</span><span>STA: {char.stamina}</span>
              <span>DEX: {char.dexterity}</span><span>INT: {char.intelligence}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Unspent GP: {char.remainGp}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Position</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">{worldName(char.worldId)} (zone {char.zoneId})</p>
            <p className="text-xs text-muted-foreground">X: {char.x.toFixed(1)} Y: {char.y.toFixed(1)} Z: {char.z.toFixed(1)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">PK State</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <p>Propensity: {char.pkPropensity}</p>
              <p>Value: {char.pkValue}</p>
              <p>PK Exp: {char.pkExp}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Skills</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">SP: {char.skillPoint} (earned: {char.skillLevel})</p>
            <p className="text-sm">{charSkills.length} learned skills</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-4">
        <h2 className="text-base font-semibold">Edit Character Stats</h2>
        <EditStatsForm characterId={char.id} stats={char} />
      </div>

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory ({invItems.length})</TabsTrigger>
          <TabsTrigger value="skills">Skills ({charSkills.length})</TabsTrigger>
          <TabsTrigger value="quests">Quests ({activeQuests.length} active)</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>Inventory</CardTitle>
              <CardDescription>
                Gold: {formatNumber(invRow[0]?.gold ?? "0")} · {invItems.length} items · hover for stats
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InventoryExplorer
                characterId={charId}
                bagItems={resolvedInv.filter((i) => i.slot < 42)}
                equipItems={resolvedInv.filter((i) => i.slot >= 42)}
                pickerItems={[]}
                readOnly
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
              <CardDescription>
                SP: {formatNumber(char.skillPoint)} · {charSkills.length} learned skills · hover for stats
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SkillExplorer items={resolvedSkills} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quests">
          <Card>
            <CardHeader>
              <CardTitle>Active Quests</CardTitle>
              <CardDescription>{completedQuests.length} completed</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Quest ID</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Kill 0</TableHead>
                      <TableHead className="text-right">Kill 1</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeQuests.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell>{q.questId}</TableCell>
                        <TableCell><Badge variant="secondary">{q.state}</Badge></TableCell>
                        <TableCell className="text-right">{q.killNpcNum0}</TableCell>
                        <TableCell className="text-right">{q.killNpcNum1}</TableCell>
                        <TableCell>{q.time}</TableCell>
                      </TableRow>
                    ))}
                    {activeQuests.length === 0 && (
                      <EmptyRow colSpan={5}>No active quests</EmptyRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Resolve inventory DB rows into rich `SlotItem`s for the read-only grid. Shared
 * shape with the dedicated inventory page so the same client components render
 * both surfaces.
 */
async function resolveSlotItems(
  rows: Array<{
    id: number; slot: number; itemId: number; quantity: number;
    refine: number; element: number; elementLevel: number;
    durability: number; flags: number;
  }>,
): Promise<SlotItem[]> {
  const out: SlotItem[] = [];
  for (const r of rows) {
    const def = await getItem(r.itemId);
    out.push({
      id: r.id,
      slot: r.slot,
      itemId: r.itemId,
      quantity: r.quantity,
      refine: r.refine,
      element: r.element,
      elementLevel: r.elementLevel,
      durability: r.durability,
      flags: r.flags,
      name: def?.name ?? `Item #${r.itemId}`,
      iconUrl: itemIconUrl(def?.icon),
      category: def?.item_kind3 ? getIk3Label(def.item_kind3) : "Unknown",
      kind2: def?.item_kind2 ?? "",
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
  return out;
}

/**
 * Resolve character skill DB rows into rich `SkillSlotItem`s for the interactive
 * grid. Joins each DB row with the skill definition from @flyff/resources.
 */
async function resolveSkills(
  rows: Array<{ id: number; slot: number; skillId: number; level: number }>,
): Promise<SkillSlotItem[]> {
  const out: SkillSlotItem[] = [];
  for (const r of rows) {
    const def = await getSkill(r.skillId);
    // Pick the stats for the character's current learned level.
    const currentLevel = def?.levels.find((l) => l.level === r.level);
    out.push({
      id: r.id,
      slot: r.slot,
      skillId: r.skillId,
      level: r.level,
      name: def?.name ?? `Skill #${r.skillId}`,
      description: def?.description,
      iconUrl: skillIconUrl(def?.icon),
      tier: def?.tier ?? 0,
      job: def?.job ?? 0,
      maxLevel: def?.maxLevel ?? 1,
      element: def?.element,
      resourceType: def?.resourceType ?? 0,
      reqLevel: def?.reqLevel,
      weaponType: def?.weaponType,
      exeTarget: def?.exeTarget,
      currentLevel: currentLevel
        ? {
            abilityMin: currentLevel.abilityMin,
            abilityMax: currentLevel.abilityMax,
            probability: currentLevel.probability,
            reqMp: currentLevel.reqMp,
            reqFp: currentLevel.reqFp,
            cooldown: currentLevel.cooldown,
            castingTime: currentLevel.castingTime,
            skillRange: currentLevel.skillRange,
            skillTime: currentLevel.skillTime,
            skillCount: currentLevel.skillCount,
            destParams: currentLevel.destParams,
            adjParamVals: currentLevel.adjParamVals,
            chgParamVals: currentLevel.chgParamVals,
          }
        : undefined,
    });
  }
  return out;
}
