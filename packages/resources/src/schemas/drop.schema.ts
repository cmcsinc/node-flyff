/**
 * Zod schema for drop tables generated from propMoverEx.inc.
 *
 * ## `chance` is a percent, and why it is not the C++ integer
 *
 * The C++ stores a raw DWORD and rolls `xRandom( 3000000000 ) < dwProbability`
 * (`_Common/Project.cpp:184-206`). Two things make that number unusable as-is:
 *
 * 1. **It does not mean what it says.** `xRandom(n)` is `xRand() % n` over a
 *    32-bit LCG (`_Common/xUtil.h:14-28`). Since 2^32 = 3e9 + 1,294,967,296,
 *    every residue below 1,294,967,296 has two preimages and so fires twice as
 *    often as one above it. Every probability in the shipped `propMoverEx.inc`
 *    sits below that line, so every drop in the game lands at ~1.3968x its
 *    nominal value: `prob: 300000000` reads as 10% and behaves as 13.97%.
 * 2. **It is not editable.** No human reasons about 300000000/3e9, and a GM
 *    cannot tell a 2x buff from a rounding error at that magnitude.
 *
 * So `chance` is the **observed** rate as a percent, calibrated from the biased
 * C++ roll at conversion time (`scripts/converters/drops.ts` -> `calibratePct`),
 * and the runtime rolls it unbiased. Live drop rates are unchanged; the number is
 * merely honest now. Logged in `docs/c++-fidelity-audit.md`.
 *
 * ## Fields that were renamed
 *
 * `level` -> `enchant`: the third `DropItem(...)` arg is not a level requirement.
 * It parses into `di.dwLevel` (`Project.cpp:2884`) whose only live use is
 * `pItemElem->SetAbilityOption( lpDropItem->dwLevel )` (`Mover.cpp:8005`) -- the
 * +1/+2 enchant on the dropped instance. Nothing gates on it.
 *
 * @module schemas/drop.schema
 */

import { z } from 'zod';

export const DropItemSchema = z.object({
  /** Resolved numeric item id (`II_*` -> id). */
  itemId: z.number().int().positive(),
  /**
   * Drop chance as a percent, `0 < chance <= 100`. This is the rate before the
   * level-difference gate and any server rate multiplier.
   *
   * Bounded below by 1e-7 (one in a billion) rather than 0: the shipped floor is
   * `prob: 300` = 0.0000140%, and a slot with chance 0 is one that should be
   * deleted, not one that silently never fires.
   */
  chance: z.number().min(1e-7).max(100),
  /**
   * `+N` ability option stamped on the dropped instance (C++ `dwLevel` ->
   * `SetAbilityOption`). 0 for a plain item.
   */
  enchant: z.number().int().min(0).default(0),
  /**
   * Maximum stack dropped -- the C++ rolls `xRandom(dwNumber) + 1`
   * (`Mover.cpp:7970`), so a `count: 10` slot yields a uniform 1..10, not 10.
   */
  count: z.number().int().positive(),
});
export type DropItem = z.infer<typeof DropItemSchema>;

export const DropTableSchema = z.object({
  /** Symbolic `MI_*` name. */
  key: z.string(),
  /** Numeric model index -- matches `CMover.m_dwIndex` for O(1) lookup at death. */
  modelIdx: z.number().int().nonnegative(),
  /**
   * Cap on how many *item* slots may drop in one kill (`Maxitem`). Gold does not
   * count toward it -- the C++ counter is bumped only in the DROPTYPE_NORMAL
   * branch (`Mover.cpp:8046`), never in DROPTYPE_SEED. 0 means uncapped.
   */
  maxItem: z.number().int().nonnegative(),
  /** Penya pile range, or `null` if the mob drops no gold. */
  gold: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).nullable(),
  /**
   * Per-mover drop-rate multiplier, mirroring the C++
   * `GetProp()->m_fItemDrop_Rate` (`ProjectCmn.h:838`, default 1.0, fed from the
   * back-end DB rather than from `propMoverEx.inc`). Absent = 1.0. Lets one boss
   * be buffed without touching the global rate.
   */
  dropRate: z.number().positive().optional(),
  /** Slots, in file order (C++ `SortDropItem` is dead code and never runs). */
  items: z.array(DropItemSchema),
});
export type DropTable = z.infer<typeof DropTableSchema>;

export const DropFileSchema = z.object({
  _version: z.string(),
  drops: z.array(DropTableSchema),
});
