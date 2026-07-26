import type { Knex } from '../types';

/**
 * Per-character active timed buffs (`characters.buffs`).
 *
 * C++ persists the active skill-buff list as a packed string column
 * (`SkillInfluence`, save `DbManagerSave.cpp:SaveSkillInfluence:1079`, load
 * `DbManagerFun.cpp:GetSKillInfluence:1384`). Each entry is 4 ints
 * `{ type, id, level, total }` where `total` is the originally-applied TOTAL
 * duration (not remaining) -- the timer resets to full on relog. We store the
 * same 4-int shape as JSON for parity with the `taskbar` column (migration
 * 009): `[{ t, s, l, d }, ...]` = `{ type, skillId, level, totalMs }`.
 * Effects/DST are NOT persisted -- C++ re-derives them from `prj.skillProp` on
 * load; `JoinService.loadBuffs` does the same via the skill index. Nullable: a
 * fresh character has no active buffs (null -> none restored on JOIN).
 *
 * `BUFF_EQUIP` is never stored (equip DST is recomputed from inventory at load
 * via `applyEquipDstParams`).
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.text('buffs').nullable().defaultTo(null);
  });
}

/**
 * Reverse -- drop the column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('buffs');
  });
}
