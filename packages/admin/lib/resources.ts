import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";

const RESOURCES_DIR = resolve(process.cwd(), "../../packages/resources/data");

/** Resource type → directory under RESOURCES_DIR. Shared with the edit route. */
export const TYPE_DIRS: Record<string, string> = {
  items: "items",
  movers: "movers",
  skills: "skills",
  quests: "quests",
  drops: "drops",
  dialogues: "dialogues",
  "set-items": "set-items",
  zones: "worlds/zones",
};

function readYamlFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = parseYaml(readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readYamlDir(dirPath: string): Record<string, unknown>[] {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".yml") && !f.startsWith("_"));
  return files
    .map((f) => readYamlFile(join(dirPath, f)))
    .filter((d): d is Record<string, unknown> => d !== null);
}

function dirFor(type: string): string {
  const dir = TYPE_DIRS[type];
  if (!dir) throw new Error(`Unknown resource type: ${type}`);
  return dir;
}

export function loadItems() {
  return readYamlDir(join(RESOURCES_DIR, "items"));
}

export function loadMovers() {
  return readYamlDir(join(RESOURCES_DIR, "movers"));
}

export function loadSkills() {
  return readYamlDir(join(RESOURCES_DIR, "skills"));
}

export function loadQuests() {
  return readYamlDir(join(RESOURCES_DIR, "quests"));
}

export function loadDrops() {
  return readYamlDir(join(RESOURCES_DIR, "drops"));
}

export function loadZones() {
  return readYamlDir(join(RESOURCES_DIR, "worlds/zones"));
}

export function loadSetItems() {
  return readYamlDir(join(RESOURCES_DIR, "set-items"));
}

export function loadDialogues() {
  return readYamlDir(join(RESOURCES_DIR, "dialogues"));
}

/** Collection keys that hold arrays of entries within a YAML file. */
const COLLECTION_KEYS = ["items", "movers", "skills", "drops", "sets", "zones"] as const;

/**
 * Find a single resource entry by id/type by scanning its directory once.
 * Replaces the ad-hoc filesystem scan duplicated in the edit route.
 */
export function loadEntryById(
  type: string,
  id: string,
): { file: string; entry: Record<string, unknown> } | null {
  const dirPath = join(RESOURCES_DIR, dirFor(type));
  if (!existsSync(dirPath)) return null;
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".yml") && !f.startsWith("_"));
  for (const file of files) {
    const filePath = join(dirPath, file);
    const parsed = readYamlFile(filePath);
    if (!parsed) continue;
    for (const key of COLLECTION_KEYS) {
      const list = parsed[key];
      if (Array.isArray(list)) {
        const found = list.find((e): e is Record<string, unknown> => {
          if (typeof e !== "object" || e === null) return false;
          return String((e as Record<string, unknown>).id) === id;
        });
        if (found) return { file: filePath, entry: found };
      }
    }
    if (String(parsed.id) === id || String(parsed._id_numeric) === id) {
      return { file: filePath, entry: parsed };
    }
    if (parsed.prefix === id) return { file: filePath, entry: parsed };
  }
  return null;
}
