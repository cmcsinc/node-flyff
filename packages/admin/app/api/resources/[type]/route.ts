import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { auth } from "@/lib/auth";

const RESOURCES_DIR = resolve(process.cwd(), "../../packages/resources/data");

const TYPE_DIRS: Record<string, string> = {
  items: "items",
  movers: "movers",
  skills: "skills",
  quests: "quests",
  drops: "drops",
  dialogues: "dialogues",
  "set-items": "set-items",
  zones: "worlds/zones",
};

function findYamlFile(type: string, id: string): string | null {
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
      // Check arrays (items, movers, skills, drops, sets)
      for (const key of ["items", "movers", "skills", "drops", "sets"]) {
        if (Array.isArray(parsed[key])) {
          const found = parsed[key].find((e: Record<string, unknown>) => String(e.id) === id);
          if (found) return filePath;
        }
      }
      // Check top-level id (quests, zones)
      if (String(parsed.id) === id || String(parsed._id_numeric) === id) return filePath;
      // Check prefix (dialogues)
      if (parsed.prefix === id) return filePath;
    } catch { /* skip unreadable files */ }
  }
  return null;
}

function readEntry(type: string, id: string): { file: string; entry: unknown } | null {
  const filePath = findYamlFile(type, id);
  if (!filePath) return null;
  const content = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(content);
  if (typeof parsed !== "object" || parsed === null) return null;
  for (const key of ["items", "movers", "skills", "drops", "sets"]) {
    if (Array.isArray(parsed[key])) {
      const found = parsed[key].find((e: Record<string, unknown>) => String(e.id) === id);
      if (found) return { file: filePath, entry: found };
    }
  }
  if (String(parsed.id) === id || String(parsed._id_numeric) === id) return { file: filePath, entry: parsed };
  if (parsed.prefix === id) return { file: filePath, entry: parsed };
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id param" }, { status: 400 });

  const result = readEntry(type, id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ file: result.file, entry: result.entry });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  const { id, yaml: yamlContent } = await req.json();
  if (!id || !yamlContent) return NextResponse.json({ error: "Missing id or yaml" }, { status: 400 });

  // Validate YAML parses cleanly
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (e) {
    return NextResponse.json({ error: `Invalid YAML: ${e instanceof Error ? e.message : "parse error"}` }, { status: 400 });
  }

  const filePath = findYamlFile(type, String(id));
  if (!filePath) return NextResponse.json({ error: "Source file not found" }, { status: 404 });

  // For array-based types, update the specific entry in the file
  const fileContent = readFileSync(filePath, "utf-8");
  const fileData = parseYaml(fileContent);
  if (typeof fileData !== "object" || fileData === null) {
    return NextResponse.json({ error: "Invalid source file" }, { status: 500 });
  }

  for (const key of ["items", "movers", "skills", "drops", "sets"]) {
    if (Array.isArray(fileData[key])) {
      const idx = fileData[key].findIndex((e: Record<string, unknown>) => String(e.id) === String(id));
      if (idx >= 0) {
        fileData[key][idx] = parsed;
        writeFileSync(filePath, stringifyYaml(fileData, { lineWidth: 120 }), "utf-8");
        return NextResponse.json({ ok: true });
      }
    }
  }

  // For top-level entries (quests, dialogues), overwrite the whole file
  if (String(fileData.id) === String(id) || String(fileData._id_numeric) === String(id) || fileData.prefix === id) {
    writeFileSync(filePath, stringifyYaml(parsed, { lineWidth: 120 }), "utf-8");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Entry not found in file" }, { status: 404 });
}
