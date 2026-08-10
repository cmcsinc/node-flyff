/**
 * Server-side skill catalog resolver.
 *
 * Provides access to skill definitions + icon URL resolution for the admin
 * character-detail UI, backed by the process-wide cache in
 * `lib/resource-cache.ts` (loaded once at server boot, not per request).
 *
 * @module lib/skill-catalog
 */

import type { SkillDefinition } from '@flyff/resources';
import { getResourceIndex } from './resource-cache';

/** Look up a skill definition by numeric id. */
export async function getSkill(skillId: number): Promise<SkillDefinition | undefined> {
  const res = await getResourceIndex();
  return res.skills.skills.get(skillId);
}

/** All skill definitions as an array (for potential pickers). */
export async function getAllSkills(): Promise<SkillDefinition[]> {
  const res = await getResourceIndex();
  return [...res.skills.skills.values()];
}

/**
 * Resolve a skill icon `.dds` filename to the static PNG URL served from admin/public/.
 * Returns a placeholder path when the icon is missing so the UI never has a broken img.
 */
export function skillIconUrl(icon: string | undefined): string {
  if (!icon) return '/icons/_placeholder.svg';
  return `/icons/${icon.replace(/\.dds$/i, '.png')}`;
}
