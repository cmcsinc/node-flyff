/**
 * Zod schema for drop tables generated from propMoverEx.inc.
 *
 * `prob` is a DWORD out of `_prob_scale` (3,000,000,000) — see the converter at
 * `scripts/converters/drops.ts`. Kept as the raw integer so the roll is exact.
 *
 * @module schemas/drop.schema
 */

import { z } from 'zod';

/** Probability denominator shared by every `DropItem` slot. */
export const DROP_PROB_SCALE = 3_000_000_000;

export const DropItemSchema = z.object({
  /** Resolved numeric item id (`II_*` → id). */
  itemId: z.number().int().positive(),
  /** Roll threshold — `xRandom(3e9) < prob` hits. */
  prob: z.number().int().nonnegative(),
  /** Item level requirement on the drop (propMoverEx `level`). */
  level: z.number().int().nonnegative(),
  /** Stack count dropped per hit. */
  count: z.number().int().positive(),
});
export type DropItem = z.infer<typeof DropItemSchema>;

export const DropTableSchema = z.object({
  /** Symbolic `MI_*` name. */
  key: z.string(),
  /** Numeric model index — matches `CMover.m_dwIndex` for O(1) lookup at death. */
  modelIdx: z.number().int().nonnegative(),
  /** `Maxitem` cap from propMoverEx. */
  maxItem: z.number().int().nonnegative(),
  /** Penya pile range, or `null` if the mob drops no gold. */
  gold: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).nullable(),
  /** `DropItem` slots, in file order (C++ keeps file order — sort is dead code). */
  items: z.array(DropItemSchema),
});
export type DropTable = z.infer<typeof DropTableSchema>;

export const DropFileSchema = z.object({
  _version: z.string(),
  _prob_scale: z.number().int().positive(),
  drops: z.array(DropTableSchema),
});
