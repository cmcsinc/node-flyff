/**
 * Skill resource loader.
 *
 * Loads and indexes skill definitions from YAML files produced by the
 * `converters/skills.ts` converter (propSkill.txt + propSkillAdd.csv merge).
 * One yml per job bucket (`vagrant.yml`, `magician.yml`, ...) is read; skills
 * are indexed by id, name, and job bucket.
 *
 * @module loaders/skill.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import {
  SkillFileSchema,
  SkillIndexSchema,
  type SkillDefinition,
} from '../schemas/skill.schema';

const logger = createResourceLogger('skill.loader');

/**
 * Loaded skill index structure.
 */
export interface SkillIndex {
  /** Map of skill ID -> definition */
  skills: Map<number, SkillDefinition>;
  /** Map of skill name -> definition */
  byName: Map<string, SkillDefinition>;
  /** Map of job -> array of skills */
  byJob: Map<string, SkillDefinition[]>;
}

/**
 * Loads all skills from the skills directory.
 *
 * @param dataDir - Root resources/data directory
 * @returns Skill index
 */
export async function loadSkills(dataDir: string): Promise<SkillIndex> {
  const skillsDir = resolve(dataDir, 'skills');
  const indexPath = resolve(skillsDir, '_index.yml');

  logger.info({ skillsDir }, 'Loading skills...');

  // Check if index exists
  try {
    await readFile(indexPath, 'utf-8');
  } catch {
    logger.warn('No _index.yml found, loading all .yml files');
    return await loadSkillsWithoutIndex(skillsDir);
  }

  // Load index
  const indexContent = await readFile(indexPath, 'utf-8');
  const indexData = parse(indexContent);
  const index = SkillIndexSchema.parse(indexData);

  const skills = new Map<number, SkillDefinition>();
  const byName = new Map<string, SkillDefinition>();
  const byJob = new Map<string, SkillDefinition[]>();

  const loadedFiles = new Set<string>();

  for (const [idStr, entry] of Object.entries(index)) {
    const file = entry.file;
    const filePath = resolve(skillsDir, file);

    if (loadedFiles.has(filePath)) continue;
    loadedFiles.add(filePath);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = parse(content);
      const validated = SkillFileSchema.parse(data);

      const job = validated._job || 'all';

      for (const skill of validated.skills) {
        skills.set(skill.id, skill);
        byName.set(skill.name, skill);

        if (!byJob.has(job)) {
          byJob.set(job, []);
        }
        byJob.get(job)!.push(skill);
      }

      logger.debug({ file, job, count: validated.skills.length }, 'Loaded skill file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load skill file');
      throw err;
    }
  }

  logger.info({ count: skills.size }, 'Skills loaded');

  return { skills, byName, byJob };
}

/**
 * Loads skills without an index file.
 *
 * @param skillsDir - Skills directory path
 * @returns Skill index
 */
async function loadSkillsWithoutIndex(
  skillsDir: string,
): Promise<SkillIndex> {
  const files = await readdir(skillsDir);
  const ymlFiles = files.filter((f) => f.endsWith('.yml') && f !== '_index.yml');

  const skills = new Map<number, SkillDefinition>();
  const byName = new Map<string, SkillDefinition>();
  const byJob = new Map<string, SkillDefinition[]>();

  for (const file of ymlFiles) {
    const filePath = resolve(skillsDir, file);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = parse(content);
      const validated = SkillFileSchema.parse(data);

      const job = validated._job || 'all';

      for (const skill of validated.skills) {
        skills.set(skill.id, skill);
        byName.set(skill.name, skill);

        if (!byJob.has(job)) {
          byJob.set(job, []);
        }
        byJob.get(job)!.push(skill);
      }

      logger.debug({ file, job, count: validated.skills.length }, 'Loaded skill file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load skill file');
      throw err;
    }
  }

  logger.info({ count: skills.size }, 'Skills loaded (without index)');

  return { skills, byName, byJob };
}
