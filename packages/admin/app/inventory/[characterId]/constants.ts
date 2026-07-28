/**
 * Client-safe constants for the inventory UI.
 *
 * Mirrors the engine's slot-sizing (`packages/entities/src/constants/slots.ts`)
 * but without pulling in the fs-backed resource loader, so these are safe to
 * import from client components.
 *
 * @module inventory/[characterId]/constants
 */

/** Slots 0..MAX_INVENTORY-1 = main bag; MAX_INVENTORY..+MAX_HUMAN_PARTS = equip. */
export const MAX_INVENTORY = 42;

/** Total bag slots rendered in the grid. */
export const BAG_SLOTS = MAX_INVENTORY;
