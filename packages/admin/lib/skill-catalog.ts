/**
 * Server-side skill catalog resolver.
 *
 * Provides memoized access to skill definitions + icon URL resolution for the
 * admin character-detail UI. Mirrors `item-catalog.ts` — same singleton-promise
 * pattern, same placeholder fallback.
 *
 * @module lib/skill-catalog
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllResources, type SkillDefinition, type ResourceIndex } from "@flyff/resources";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DATA_DIR = resolve(REPO_ROOT, "packages", "resources", "data");

/** Singleton promise -- resolved once, never re-loaded within the same process. */
let _catalog: Promise<ResourceIndex> | null = null;

function getCatalog(): Promise<ResourceIndex> {
  if (!_catalog) {
    _catalog = loadAllResources(DATA_DIR);
  }
  return _catalog;
}

/** Look up a skill definition by numeric id. */
export async function getSkill(skillId: number): Promise<SkillDefinition | undefined> {
  const res = await getCatalog();
  return res.skills.skills.get(skillId);
}

/** All skill definitions as an array (for potential pickers). */
export async function getAllSkills(): Promise<SkillDefinition[]> {
  const res = await getCatalog();
  return [...res.skills.skills.values()];
}

/**
 * Resolve a skill icon `.dds` filename to the static PNG URL served from admin/public/.
 * Returns a placeholder path when the icon is missing so the UI never has a broken img.
 */
export function skillIconUrl(icon: string | undefined): string {
  if (!icon) return "/icons/_placeholder.svg";
  return `/icons/${icon.replace(/\.dds$/i, ".png")}`;
}
