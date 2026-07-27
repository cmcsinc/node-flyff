import { db } from "@/lib/db";
import { accounts, characters, inventory } from "@/../drizzle/schema";
import { count, eq, sql, desc } from "drizzle-orm";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Swords, Shield, TrendingUp } from "lucide-react";
import { formatNumber, jobName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [totalAccounts] = await db.select({ value: count() }).from(accounts);
  const [totalCharacters] = await db.select({ value: count() }).from(characters);
  const [totalGm] = await db.select({ value: count() }).from(accounts).where(eq(accounts.gm, true));
  const [totalBanned] = await db.select({ value: count() }).from(accounts).where(eq(accounts.banned, true));

  const topCharacters = await db
    .select({
      id: characters.id,
      name: characters.name,
      level: characters.level,
      class: characters.class,
      worldId: characters.worldId,
    })
    .from(characters)
    .orderBy(desc(characters.level))
    .limit(10);

  const recentAccounts = await db
    .select({
      id: accounts.id,
      username: accounts.username,
      gm: accounts.gm,
      banned: accounts.banned,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
    .limit(5);

  const stats = [
    { label: "Total Accounts", value: totalAccounts.value, icon: Users, color: "text-blue-500" },
    { label: "Total Characters", value: totalCharacters.value, icon: Swords, color: "text-green-500" },
    { label: "GM Accounts", value: totalGm.value, icon: Shield, color: "text-yellow-500" },
    { label: "Banned Accounts", value: totalBanned.value, icon: TrendingUp, color: "text-red-500" },
  ];

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stat.value)}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top Characters */}
        <Card>
          <CardHeader>
            <CardTitle>Top Characters by Level</CardTitle>
            <CardDescription>Highest level characters on the server</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCharacters.map((char, i) => (
                <div key={char.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-5">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium">{char.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {jobName(char.class)} &middot; {char.worldId}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Lv. {char.level}</Badge>
                </div>
              ))}
              {topCharacters.length === 0 && (
                <p className="text-sm text-muted-foreground">No characters yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Accounts */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Accounts</CardTitle>
            <CardDescription>Latest registered accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentAccounts.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{acc.username}</p>
                    <p className="text-xs text-muted-foreground">ID: {acc.id}</p>
                  </div>
                  <div className="flex gap-1">
                    {acc.gm && <Badge variant="default">GM</Badge>}
                    {acc.banned && <Badge variant="destructive">Banned</Badge>}
                  </div>
                </div>
              ))}
              {recentAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground">No accounts yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
