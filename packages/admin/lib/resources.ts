import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";

const RESOURCES_DIR = resolve(process.cwd(), "../../packages/resources/data");

function readYamlFile(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null;
    return parseYaml(readFileSync(filePath, "utf-8"));
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
