import { db } from '@/lib/db';
import { accounts, characters } from '@/../drizzle/schema';
import { AUTH, AUTH_LABELS, hasAuthority } from '@flyff/entities/constants/authority';
import { count, eq, desc, gte } from 'drizzle-orm';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Users, Swords, Shield, Ban, Crown, Trophy } from 'lucide-react';
import { formatNumber, jobName, worldName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const [totalAccounts] = await db.select({ value: count() }).from(accounts);
  const [totalCharacters] = await db.select({ value: count() }).from(characters);
  const [totalGm] = await db
    .select({ value: count() })
    .from(accounts)
    .where(gte(accounts.authority, AUTH.GAMEMASTER));
  const [totalBanned] = await db
    .select({ value: count() })
    .from(accounts)
    .where(eq(accounts.banned, true));

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
      authority: accounts.authority,
      banned: accounts.banned,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
    .limit(5);

  const stats = [
    { label: 'Total Accounts', value: totalAccounts.value, icon: Users, tone: 'accent' as const },
    {
      label: 'Total Characters',
      value: totalCharacters.value,
      icon: Swords,
      tone: 'success' as const,
    },
    { label: 'Staff Accounts', value: totalGm.value, icon: Shield, tone: 'gold' as const },
    { label: 'Banned Accounts', value: totalBanned.value, icon: Ban, tone: 'destructive' as const },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description="Server overview at a glance" />

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            tone={stat.tone}
            index={i}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top Characters */}
        <Card className="animate-[fade-in-up_0.4s_ease-out_both]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-gold" />
              <CardTitle>Top Characters by Level</CardTitle>
            </div>
            <CardDescription>Highest level characters on the server</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCharacters.map((char, i) => (
                <div key={char.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        'flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ' +
                        (i === 0
                          ? 'bg-gold/20 text-gold'
                          : i === 1
                            ? 'bg-muted text-muted-foreground'
                            : i === 2
                              ? 'bg-warning/20 text-warning'
                              : 'text-muted-foreground')
                      }
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{char.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {jobName(char.class)} &middot; World {worldName(char.worldId)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Lv. {formatNumber(char.level)}</Badge>
                </div>
              ))}
              {topCharacters.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No characters yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Accounts */}
        <Card
          className="animate-[fade-in-up_0.4s_ease-out_both]"
          style={{ animationDelay: '80ms' }}
        >
          <CardHeader>
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" />
              <CardTitle>Recent Accounts</CardTitle>
            </div>
            <CardDescription>Latest registered accounts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentAccounts.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {acc.username.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{acc.username}</p>
                      <p className="text-xs text-muted-foreground">ID: {acc.id}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {hasAuthority(acc.authority, AUTH.GAMEMASTER) && (
                      <Badge variant="gold">{AUTH_LABELS[acc.authority] ?? 'Staff'}</Badge>
                    )}
                    {acc.banned && <Badge variant="destructive">Banned</Badge>}
                    {!hasAuthority(acc.authority, AUTH.GAMEMASTER) && !acc.banned && (
                      <Badge variant="success">Active</Badge>
                    )}
                  </div>
                </div>
              ))}
              {recentAccounts.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No accounts yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
