import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

function loadJsonSafe(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const configDir = resolve(process.cwd(), "../../config");
  const defaultConfig = loadJsonSafe(resolve(configDir, "default.json"));
  const loginConfig = loadJsonSafe(resolve(configDir, "login-server.json"));
  const clusterConfig = loadJsonSafe(resolve(configDir, "cluster-server.json"));
  const worldConfig = loadJsonSafe(resolve(configDir, "world-server.json"));

  const sections = [
    { label: "Default Config", data: defaultConfig },
    { label: "Login Server", data: loginConfig },
    { label: "Cluster Server", data: clusterConfig },
    { label: "World Server", data: worldConfig },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Server configuration (read-only)</p>
      </div>

      <div className="grid gap-4">
        {sections.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardTitle>{s.label}</CardTitle>
              <CardDescription>{s.data ? "Loaded from config/*.json" : "Not found"}</CardDescription>
            </CardHeader>
            <CardContent>
              {s.data ? (
                <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">
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
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>Key env vars detected at runtime</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">DB_CLIENT</span>
            <span>{process.env.DB_CLIENT ?? "better-sqlite3 (default)"}</span>
            <span className="text-muted-foreground">DB_FILENAME</span>
            <span>{process.env.DB_FILENAME ?? "./dev.sqlite3 (default)"}</span>
            <span className="text-muted-foreground">NODE_ENV</span>
            <span>{process.env.NODE_ENV ?? "development"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
