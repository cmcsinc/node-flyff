/**
 * Zone resource loader.
 *
 * Loads and indexes zone definitions from YAML files.
 *
 * @module loaders/zone.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import {
  ZoneDefinitionSchema,
} from '../schemas/zone.schema';
import type { ZoneDefinition } from '../schemas/zone.schema';

const logger = createResourceLogger('zone.loader');

/**
 * Loaded zone index structure.
 */
export interface ZoneIndex {
  /** Map of zone ID -> definition */
  zones: Map<string, ZoneDefinition>;

  /** Map of numeric ID -> definition */
  byNumericId: Map<number, ZoneDefinition>;

  /** Map of world ID -> array of zones */
  byWorld: Map<string, ZoneDefinition[]>;
}

/**
 * Loads all zones from the worlds/zones directory.
 *
 * @param dataDir - Root resources/data directory
 * @returns Zone index
 */
export async function loadZones(dataDir: string): Promise<ZoneIndex> {
  const zonesDir = resolve(dataDir, 'worlds', 'zones');

  logger.info({ zonesDir }, 'Loading zones...');

  const files = await readdir(zonesDir);
  const ymlFiles = files.filter((f) => f.endsWith('.yml'));

  const zones = new Map<string, ZoneDefinition>();
  const byNumericId = new Map<number, ZoneDefinition>();
  const byWorld = new Map<string, ZoneDefinition[]>();

  for (const file of ymlFiles) {
    const filePath = resolve(zonesDir, file);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data: unknown = parse(content);
      const zone = ZoneDefinitionSchema.parse(data);

      zones.set(zone._id, zone);
      byNumericId.set(zone._id_numeric, zone);

      const bucket = byWorld.get(zone.world_id);
      if (bucket === undefined) {
        byWorld.set(zone.world_id, [zone]);
      } else {
        bucket.push(zone);
      }

      logger.debug({ file, zone: zone._id }, 'Loaded zone file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load zone file');
      throw err;
    }
  }

  logger.info({ count: zones.size }, 'Zones loaded');

  return { zones, byNumericId, byWorld };
}
