import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const dynamic = 'force-dynamic';

function loadJsonSafe(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (typeof raw !== 'object' || raw === null) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function SettingsPage(): React.JSX.Element {
  const configDir = resolve(process.cwd(), '../../config');
  const defaultConfig = loadJsonSafe(resolve(configDir, 'default.json'));
  const loginConfig = loadJsonSafe(resolve(configDir, 'login-server.json'));
  const clusterConfig = loadJsonSafe(resolve(configDir, 'cluster-server.json'));
  const worldConfig = loadJsonSafe(resolve(configDir, 'world-server.json'));

  const sections = [
    { label: 'Default Config', data: defaultConfig },
    { label: 'Login Server', data: loginConfig },
    { label: 'Cluster Server', data: clusterConfig },
    { label: 'World Server', data: worldConfig },
  ];

  const envVars = [
    { key: 'DB_CLIENT', value: process.env.DB_CLIENT ?? 'better-sqlite3 (default)' },
    { key: 'DB_FILENAME', value: process.env.DB_FILENAME ?? './dev.sqlite3 (default)' },
    { key: 'NODE_ENV', value: process.env.NODE_ENV },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Server configuration (read-only)" />

      <div className="grid gap-4">
        {sections.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">{s.label}</CardTitle>
                <Badge variant={s.data ? 'success' : 'outline'}>
                  {s.data ? 'Loaded' : 'Not found'}
                </Badge>
              </div>
              <CardDescription>Loaded from config/*.json</CardDescription>
            </CardHeader>
            <CardContent>
              {s.data ? (
                <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs">
                  {JSON.stringify(s.data, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">Configuration file not present</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Environment Variables</CardTitle>
          <CardDescription>Key env vars detected at runtime</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            {envVars.map((env) => (
              <div key={env.key} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3 sm:gap-4">
                <dt className="font-mono text-xs text-muted-foreground">{env.key}</dt>
                <dd className="font-mono text-xs sm:col-span-2">{env.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
