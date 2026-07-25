/**
 * Zod schema for set items generated from propItemEtc.inc.
 *
 * Mirrors `CSetItem` (`Project.h:747`) + its `Elem`/`Avail` sub-structs. All
 * symbols (`II_*`/`PARTS_*`/`DST_*`) are pre-resolved to numerics by the
 * converter at `scripts/converters/setItems.ts`, so the loader validates plain
 * integers with no header dependency.
 *
 * @module schemas/setItem
 */

import { z } from 'zod';

export const SetItemElemSchema = z.object({
  /** Resolved propItem id (II_* -> defineItem.h). */
  itemId: z.number().int().positive(),
  /** Equip slot index (PARTS_* -> defineNeuz.h). */
  parts: z.number().int().nonnegative(),
});
export type SetItemElem = z.infer<typeof SetItemElemSchema>;

export const SetItemAvailSchema = z.object({
  /** Destination `DST_*` id (defineAttribute.h). */
  dst: z.number().int().nonnegative(),
  /** Additive adjustment. */
  adj: z.number().int(),
  /** Piece count at which this bonus unlocks. */
  equipped: z.number().int().positive(),
});
export type SetItemAvail = z.infer<typeof SetItemAvailSchema>;

export const SetItemDefSchema = z.object({
  id: z.number().int().positive(),
  /** String-table id (IDS_PROPITEMETC_*) -- cosmetic, unused server-side. */
  nameId: z.string(),
  elems: z.array(SetItemElemSchema),
  /** Converter sorts ascending by `equipped` (C++ SortItemAvail). */
  avails: z.array(SetItemAvailSchema),
});
export type SetItemDef = z.infer<typeof SetItemDefSchema>;

export const SetItemFileSchema = z.object({
  _version: z.string(),
  sets: z.array(SetItemDefSchema),
});
