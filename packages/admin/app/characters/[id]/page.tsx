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
import { formatNumber, jobName } from "@/lib/utils";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={char.name}
        description={`${jobName(char.class)} · Level ${char.level} · ${char.worldId}`}
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
            <p className="text-sm">{char.worldId} (zone {char.zoneId})</p>
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
              <CardDescription>Gold: {formatNumber(invRow[0]?.gold ?? "0")}</CardDescription>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.slot}</TableCell>
                        <TableCell>{item.itemId}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell>{item.refine > 0 ? `+${item.refine}` : "—"}</TableCell>
                        <TableCell>{item.element > 0 ? `${item.element}/${item.elementLevel}` : "—"}</TableCell>
                        <TableCell>{item.durability === -1 ? "∞" : item.durability}</TableCell>
                      </TableRow>
                    ))}
                    {invItems.length === 0 && (
                      <EmptyRow colSpan={6}>Empty inventory</EmptyRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Slot</TableHead>
                      <TableHead>Skill ID</TableHead>
                      <TableHead className="text-right">Level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {charSkills.map((sk) => (
                      <TableRow key={sk.id}>
                        <TableCell className="font-mono text-xs">{sk.slot}</TableCell>
                        <TableCell>{sk.skillId}</TableCell>
                        <TableCell className="text-right">{sk.level}</TableCell>
                      </TableRow>
                    ))}
                    {charSkills.length === 0 && (
                      <EmptyRow colSpan={3}>No skills learned</EmptyRow>
                    )}
                  </TableBody>
                </Table>
              </div>
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
