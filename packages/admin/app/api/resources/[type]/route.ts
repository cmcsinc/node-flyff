import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { parse as parseYaml, parseDocument, stringify as stringifyYaml, isSeq } from "yaml";
import {
  DropTableSchema,
  ItemDefinitionSchema,
  MoverDefinitionSchema,
  SetItemDefSchema,
  SkillDefinitionSchema,
} from "@flyff/resources";
import { auth } from "@/lib/auth";
import { loadEntryById, invalidateResourceCache, entryMatches } from "@/lib/resources";

/**
 * Canonical schema per resource type, applied server-side before the write.
 *
 * Client-side typing is UX; this is the guarantee. Every collection type the
 * editor can reach is listed — a malformed mover null-derefs the client's
 * `OnAddObj`, and a malformed item breaks the JOIN serializer, so neither may
 * reach disk on the strength of client-side typing alone.
 *
 * `quests`, `dialogues`, and `zones` are absent by design: they are whole-file
 * documents, not collection entries, and each has its own route with a writer
 * that understands the file's raw counterpart.
 */
const ENTRY_SCHEMAS = {
  drops: DropTableSchema,
  items: ItemDefinitionSchema,
  movers: MoverDefinitionSchema,
  skills: SkillDefinitionSchema,
  "set-items": SetItemDefSchema,
} as const;

/**
 * Gate the entry on its canonical schema.
 *
 * Returns the **submitted** value, never `parsed.data`: several schemas carry
 * `.default()`s (mover `scale`/`mp`/`fp`, drop `radius`), and writing the parsed
 * object would inject those keys into entries that legitimately omit them.
 * A key absent from the source entry stays absent — rule 12.
 */
function validateEntry(type: string, entry: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = ENTRY_SCHEMAS[type as keyof typeof ENTRY_SCHEMAS];
  if (!schema) return { ok: true, value: entry };
  const parsed = schema.safeParse(entry);
  if (parsed.success) return { ok: true, value: entry };
  const first = parsed.error.issues[0];
  return { ok: false, error: `${first.path.join(".") || "entry"}: ${first.message}` };
}

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

  const checked = validateEntry(type, parsed);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  for (const key of ["items", "movers", "skills", "drops", "sets"]) {
    if (Array.isArray(fileData[key])) {
      const idx = fileData[key].findIndex((e: Record<string, unknown>) => entryMatches(e, String(id)));
      if (idx >= 0) {
        // Document API, not stringify(parse(...)): these files carry
        // hand-written header comments that a full re-serialize would drop.
        const doc = parseDocument(readFileSync(filePath, "utf-8"));
        const seq = doc.get(key);
        if (!isSeq(seq)) return NextResponse.json({ error: "Unusable collection node" }, { status: 500 });
        seq.set(idx, doc.createNode(checked.value));
        writeFileSync(filePath, doc.toString({ lineWidth: 120 }), "utf-8");
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
