/**
 * Cross-file reference validator.
 *
 * Validates that references between resource files are valid.
 * For example: zone spawn mover_id must exist in movers index.
 *
 * @module validators
 */

import type { ResourceIndex } from '../index';
import { createResourceLogger } from '../logger';

const logger = createResourceLogger('validators');

/**
 * Validation error.
 */
export class ValidationError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Resource validation failed:\n${errors.join('\n')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Validates all cross-file references.
 *
 * @param resources - Loaded resource index
 * @throws ValidationError if any invalid references found
 */
export function validateReferences(resources: ResourceIndex): void {
  const errors: string[] = [];

  // Validate zone spawns reference valid movers
  for (const [zoneId, zone] of resources.zones.zones) {
    for (const spawn of zone.spawns) {
      if (!resources.movers.movers.has(spawn.mover_id)) {
        errors.push(
          `Zone ${zoneId}: Spawn ${String(spawn.id)} references invalid mover_id ${String(spawn.mover_id)}`
        );
      }
    }
  }

  // Validate zone NPCs reference valid movers
  for (const [zoneId, zone] of resources.zones.zones) {
    for (const npc of zone.npcs) {
      if (!resources.movers.movers.has(npc.mover_id)) {
        errors.push(
          `Zone ${zoneId}: NPC ${String(npc.id)} references invalid mover_id ${String(npc.mover_id)}`
        );
      }
    }
  }

  // Validate portal targets exist
  for (const [zoneId, zone] of resources.zones.zones) {
    for (const portal of zone.portals) {
      if (!resources.zones.zones.has(portal.target.zone)) {
        errors.push(
          `Zone ${zoneId}: Portal ${String(portal.id)} targets non-existent zone ${portal.target.zone}`
        );
      }
    }
  }

  // Validate region quest requirements exist
  for (const [zoneId, zone] of resources.zones.zones) {
    for (const region of zone.regions) {
      if (region.requirements?.quest_id !== undefined) {
        // Quest validation would go here when quest system is implemented
        // For now, just log a warning
        console.warn(
          `Zone ${zoneId}: Region ${String(region.id)} has quest requirement ${String(region.requirements.quest_id)} (quest system not yet implemented)`
        );
      }

      if (region.requirements?.item_req !== undefined) {
        const { id } = region.requirements.item_req;
        if (!resources.items.items.has(id)) {
          errors.push(
            `Zone ${zoneId}: Region ${String(region.id)} references invalid item_id ${String(id)}`
          );
        }
      }
    }
  }

  // Validate NPC shop references
  for (const [zoneId, zone] of resources.zones.zones) {
    for (const npc of zone.npcs) {
      for (const func of npc.functions) {
        if (func.type === 'shop' && func.shop_id) {
          // Shop validation would go here when shop system is implemented
          // For now, just verify the shop_id format is valid
          if (!/^[a-z-]+$/.test(func.shop_id)) {
            errors.push(
              `Zone ${zoneId}: NPC ${String(npc.id)} has invalid shop_id format "${func.shop_id}"`
            );
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * Validates resources and logs the result.
 *
 * @param resources - Loaded resource index
 * @returns true if valid, false otherwise
 */
export function validateAndLog(resources: ResourceIndex): boolean {
  try {
    validateReferences(resources);
    logger.info('[OK] Resource validation passed');
    return true;
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error('[FAIL] Resource validation failed:');
      for (const error of err.errors) {
        console.error(`   ${error}`);
      }
    } else {
      console.error('[FAIL] Unexpected validation error:', err);
    }
    return false;
  }
}
