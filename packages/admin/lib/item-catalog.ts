/**
 * Server-side item catalog resolver.
 *
 * Provides access to item definitions + icon URL resolution for the admin
 * inventory UI, backed by the process-wide cache in `lib/resource-cache.ts`
 * (loaded once at server boot, not per request). Keep it out of the middleware
 * import chain (Edge Runtime has no `fs`).
 *
 * @module lib/item-catalog
 */

import type { ItemDefinition } from "@flyff/resources";
import { getResourceIndex } from "./resource-cache";

/** Look up an item definition by numeric id. */
export async function getItem(itemId: number): Promise<ItemDefinition | undefined> {
  const res = await getResourceIndex();
  return res.items.items.get(itemId);
}

/** All item definitions as an array (for the "Add item" picker). */
export async function getAllItems(): Promise<ItemDefinition[]> {
  const res = await getResourceIndex();
  return [...res.items.items.values()];
}

/**
 * Resolve an icon `.dds` filename to the static PNG URL served from admin/public/.
 * Returns a placeholder path when the icon is missing so the UI never has a broken img.
 */
export function itemIconUrl(icon: string | undefined): string {
  if (!icon) return "/icons/_placeholder.svg";
  return `/icons/${icon.replace(/\.dds$/i, ".png")}`;
}

// --- Equipment slot / PARTS constants ----------------------------------------

/** MAX_INVENTORY from the game engine (slots 0..41 = bag, 42..72 = equip). */
export const MAX_INVENTORY = 42;

/**
 * PARTS body-part labels — maps the numeric `equip_slot` (propItem `dwParts`)
 * to a human-readable label. Sourced from `game/resource/defineNeuz.h`.
 */
export const PARTS_LABELS: Record<number, string> = {
  0: "Head",
  1: "Hair",
  2: "Upper Body",
  3: "Lower Body",
  4: "Hand",
  5: "Foot",
  6: "Helmet",
  7: "Robe",
  8: "Cloak",
  9: "Left Weapon",
  10: "Right Weapon",
  11: "Shield",
  12: "Mask",
  13: "Ride",
  14: "Costume Cap",
  15: "Costume Upper",
  16: "Costume Lower",
  17: "Costume Hand",
  18: "Costume Foot",
  19: "Necklace",
  20: "Ring 1",
  21: "Ring 2",
  22: "Earring 1",
  23: "Earring 2",
  24: "Property",
  25: "Bullet",
  26: "Fashion Hat",
  27: "Fashion Cloth",
  28: "Fashion Glove",
  29: "Fashion Boots",
  30: "Tail",
};

/** Convert an inventory slot index (42+) to the body-part number. */
export function equipSlotToPart(slot: number): number {
  return slot - MAX_INVENTORY;
}

/** Get the label for an inventory slot index (42+). Returns undefined for bag slots. */
export function equipSlotLabel(slot: number): string | undefined {
  if (slot < MAX_INVENTORY) return undefined;
  return PARTS_LABELS[slot - MAX_INVENTORY];
}

/** Element names by numeric id (propItem element field). */
export const ELEMENT_NAMES: Record<number, string> = {
  0: "None",
  1: "Fire",
  2: "Water",
  3: "Electric",
  4: "Wind",
  5: "Earth",
};
