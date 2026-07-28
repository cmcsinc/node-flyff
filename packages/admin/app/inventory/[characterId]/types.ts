/**
 * Shared types for the interactive inventory UI.
 *
 * A `SlotItem` is a fully-resolved, serializable view of one inventory row --
 * the server component joins the DB row with its item definition + icon URL so
 * the client components need no further metadata lookups.
 *
 * @module inventory/[characterId]/types
 */

export interface DstEffect {
  dst: number;
  adj: number;
}

export interface SlotItem {
  /** inventory_item row id. */
  id: number;
  slot: number;
  itemId: number;
  quantity: number;
  refine: number;
  element: number;
  elementLevel: number;
  durability: number;
  flags: number;

  // Resolved from the item definition:
  name: string;
  iconUrl: string;
  category: string;
  kind2: string;
  rarity?: string;
  attackMin?: number;
  attackMax?: number;
  defense?: number;
  defenseMax?: number;
  magicDefense?: number;
  hitRate?: number;
  parry?: number;
  effects?: DstEffect[];
  levelReq?: number;
  jobReq?: string[];
  genderReq?: string;
  price?: number;
  stackSize?: number;
  twoHanded?: boolean;
}

/** A lightweight item entry for the "Add item" picker (name + icon + id only). */
export interface PickerItem {
  id: number;
  name: string;
  iconUrl: string;
  category: string;
  stackSize: number;
}
