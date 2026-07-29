import { db } from "@/lib/db";
import { characters, accounts, inventory, inventoryItems, skills, characterQuests, characterCompletedQuests, onlinePlayers } from "@/../drizzle/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { formatNumber, jobName, worldName } from "@/lib/utils";
import { getIk3Label } from "@/lib/game-constants";
import { getAllItems, getItem, itemIconUrl } from "@/lib/item-catalog";
import { getSkill, skillIconUrl } from "@/lib/skill-catalog";
import { InventoryExplorer } from "../../inventory/[characterId]/inventory-explorer";
import { GoldEditor } from "../../inventory/[characterId]/actions";
import type { PickerItem, SlotItem } from "../../inventory/[characterId]/types";
import type { SkillSlotItem } from "./skills/types";
import { resolveQuests } from "./quests/resolve";
import { SkillExplorer } from "./skills/skill-explorer";
import { QuestExplorer } from "./quests/quest-explorer";
import { EditStatsForm } from "./edit-stats";
import { LiveOpsButton } from "./live-ops";
import { OnlineIndicator } from "@/components/online-indicator";
import { isOnline } from "@/lib/presence";
import { MeterBar, DataRow } from "@/components/ui/meter";
import { ResponsiveSections } from "./responsive-sections";

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
  const [presence] = await db.select().from(onlinePlayers).where(eq(onlinePlayers.characterId, charId)).limit(1);
  const online = isOnline(presence);

  const resolvedInv = await resolveSlotItems(invItems);
  const resolvedSkills = await resolveSkills(charSkills);
  const resolvedActiveQuests = await resolveQuests(activeQuests);
  const resolvedCompletedQuests = await resolveQuests(completedQuests, true);

  // Build picker list for the add-item control (editable inventory).
  const allItems = await getAllItems();
  const pickerItems: PickerItem[] = allItems
    .filter((it) => it.icon)
    .map((it) => ({
      id: it.id,
      name: it.name,
      iconUrl: itemIconUrl(it.icon),
      category: it.item_kind3 ? getIk3Label(it.item_kind3) : "",
      stackSize: it.stack_size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const bagItems = resolvedInv.filter((i) => i.slot < 42);
  const equipItems = resolvedInv.filter((i) => i.slot >= 42);

  const inventorySection = (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Inventory</CardTitle>
            <CardDescription className="text-xs">
              {formatNumber(invRow[0]?.gold ?? "0")} gold · {invItems.length} items
            </CardDescription>
          </div>
          <GoldEditor characterId={charId} currentGold={Number(invRow[0]?.gold ?? 0)} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <InventoryExplorer
          characterId={charId}
          bagItems={bagItems}
          equipItems={equipItems}
          pickerItems={pickerItems}
          compact
        />
      </CardContent>
    </Card>
  );

  const skillsSection = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Skills</CardTitle>
        <CardDescription className="text-xs">
          SP: {formatNumber(char.skillPoint)} · {charSkills.length} learned
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <SkillExplorer items={resolvedSkills} />
      </CardContent>
    </Card>
  );

  const questsSection = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quests</CardTitle>
        <CardDescription className="text-xs">
          {activeQuests.length} active · {completedQuests.length} done
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <QuestExplorer
          activeItems={resolvedActiveQuests}
          completedItems={resolvedCompletedQuests}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={char.name}
        description={`${jobName(char.class)} · Level ${char.level} · ${worldName(char.worldId)}`}
        backHref="/characters"
        actions={
          <>
            <OnlineIndicator online={online} />
            <LiveOpsButton
              characterId={char.id}
              characterName={char.name}
              online={online}
              pickerItems={pickerItems}
            />
            <EditStatsForm characterId={char.id} stats={char} />
            {account ? (
              <Link href={`/accounts/${account.id}`}>
                <Badge variant="secondary">Account: {account.username}</Badge>
              </Link>
            ) : null}
          </>
        }
      />

      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="card-top-accent">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Level / EXP</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="tabular text-2xl font-bold leading-none">Lv. {char.level}</p>
            <p className="tabular text-xs text-muted-foreground">{formatNumber(char.exp)} exp in level</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vitals</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            <MeterBar label="HP" value={char.hp} max={char.maxHp} tone="destructive" />
            <MeterBar label="MP" value={char.mp} max={char.maxMp} tone="primary" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stats</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4">
              <DataRow label="STR" value={char.strength} />
              <DataRow label="STA" value={char.stamina} />
              <DataRow label="DEX" value={char.dexterity} />
              <DataRow label="INT" value={char.intelligence} />
            </div>
            <div className="mt-1.5 border-t border-border pt-1.5">
              <DataRow label="Unspent GP" value={char.remainGp} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Position</CardTitle></CardHeader>
          <CardContent>
            <DataRow label="World" value={`${worldName(char.worldId)} · zone ${char.zoneId}`} />
            <DataRow label="X" value={char.x.toFixed(1)} mono />
            <DataRow label="Y" value={char.y.toFixed(1)} mono />
            <DataRow label="Z" value={char.z.toFixed(1)} mono />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">PK state</CardTitle></CardHeader>
          <CardContent>
            <DataRow label="Propensity" value={char.pkPropensity} />
            <DataRow label="Value" value={char.pkValue} />
            <DataRow label="PK exp" value={char.pkExp} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progression</CardTitle></CardHeader>
          <CardContent>
            <DataRow label="Skill points" value={formatNumber(char.skillPoint)} />
            <DataRow label="SP earned (lifetime)" value={formatNumber(char.skillLevel)} />
            <DataRow label="Skills learned" value={charSkills.length} />
            <DataRow label="Active quests" value={activeQuests.length} />
          </CardContent>
        </Card>
      </div>

      <ResponsiveSections
        sections={[
          { key: "inventory", label: "Inventory", badge: invItems.length, content: inventorySection },
          { key: "skills", label: "Skills", badge: charSkills.length, content: skillsSection },
          { key: "quests", label: "Quests", badge: activeQuests.length, content: questsSection },
        ]}
      />
    </div>
  );
}

/**
 * Resolve inventory DB rows into rich `SlotItem`s for the InventoryExplorer.
 * Shared shape with the standalone inventory page.
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
