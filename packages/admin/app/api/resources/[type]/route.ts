import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { auth } from "@/lib/auth";
import { loadEntryById, invalidateResourceCache } from "@/lib/resources";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id param" }, { status: 400 });

  let result: { file: string; entry: Record<string, unknown> } | null;
  try {
    result = loadEntryById(type, id);
  } catch {
    return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
  }
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

  let found: { file: string; entry: Record<string, unknown> } | null;
  try {
    found = loadEntryById(type, String(id));
  } catch {
    return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
  }
  if (!found) return NextResponse.json({ error: "Source file not found" }, { status: 404 });
  const filePath = found.file;

  // Re-read from disk: the cache holds parsed docs, the write must preserve
  // whatever is on disk now (another editor may have touched the file).
  const fileData = parseYaml(readFileSync(filePath, "utf-8"));
  if (typeof fileData !== "object" || fileData === null) {
    return NextResponse.json({ error: "Invalid source file" }, { status: 500 });
  }

  for (const key of ["items", "movers", "skills", "drops", "sets"]) {
    if (Array.isArray(fileData[key])) {
      const idx = fileData[key].findIndex((e: Record<string, unknown>) => String(e.id) === String(id));
      if (idx >= 0) {
        fileData[key][idx] = parsed;
        writeFileSync(filePath, stringifyYaml(fileData, { lineWidth: 120 }), "utf-8");
        invalidateResourceCache();
        return NextResponse.json({ ok: true });
      }
    }
  }

  // For top-level entries (quests, dialogues), overwrite the whole file
  if (String(fileData.id) === String(id) || String(fileData._id_numeric) === String(id) || fileData.prefix === id) {
    writeFileSync(filePath, stringifyYaml(parsed, { lineWidth: 120 }), "utf-8");
    invalidateResourceCache();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Entry not found in file" }, { status: 404 });
}
