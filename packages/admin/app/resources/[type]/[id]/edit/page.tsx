import { notFound } from "next/navigation";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { parse as parseYaml } from "yaml";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResourceFormEditor } from "@/components/resource-form-editor";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const RESOURCES_DIR = resolve(process.cwd(), "../../packages/resources/data");
const TYPE_DIRS: Record<string, string> = {
  items: "items", movers: "movers", skills: "skills", quests: "quests",
  drops: "drops", dialogues: "dialogues", "set-items": "set-items", zones: "worlds/zones",
};

function findEntry(type: string, id: string): { file: string; entry: Record<string, unknown> } | null {
  const dir = TYPE_DIRS[type];
  if (!dir) return null;
  const dirPath = join(RESOURCES_DIR, dir);
  if (!existsSync(dirPath)) return null;
  const files = readdirSync(dirPath).filter(f => f.endsWith(".yml") && !f.startsWith("_"));
  for (const file of files) {
    const filePath = join(dirPath, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);
      if (typeof parsed !== "object" || parsed === null) continue;
      for (const key of ["items", "movers", "skills", "drops", "sets"]) {
        if (Array.isArray(parsed[key])) {
          const found = parsed[key].find((e: Record<string, unknown>) => String(e.id) === id);
          if (found) return { file: filePath, entry: found as Record<string, unknown> };
        }
      }
      if (String(parsed.id) === id || String(parsed._id_numeric) === id) return { file: filePath, entry: parsed as Record<string, unknown> };
      if (parsed.prefix === id) return { file: filePath, entry: parsed as Record<string, unknown> };
    } catch { /* skip */ }
  }
  return null;
}

function getEntryDisplayName(type: string, entry: Record<string, unknown>): string {
  // Try common name fields in priority order
  const name = entry.name ?? entry.symbol ?? entry.prefix ?? entry.key ?? entry.nameId;
  if (name && typeof name === "string" && name.length > 0) return name;
  return `#${entry.id ?? entry._id_numeric ?? "?"}`;
}

export default async function ResourceEditPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const result = findEntry(type, id);
  if (!result) notFound();
  const displayName = getEntryDisplayName(type, result.entry);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/resources/${type}`} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
          <p className="text-muted-foreground">{type} #{id} · {result.file.split("/").pop()}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Edit Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <ResourceFormEditor type={type} id={id} entry={result.entry} />
        </CardContent>
      </Card>
    </div>
  );
}
