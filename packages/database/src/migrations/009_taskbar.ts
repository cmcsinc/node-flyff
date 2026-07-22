import type { Knex } from '../types.js';

/**
 * Per-character taskbar bindings (`characters.taskbar`).
 *
 * C++ persists the F1-F9 hotkey grid as a packed string column
 * (`m_aSlotItem`, `WORLDSERVER` save path `DbManagerSave.cpp:SaveTaskBar:992`,
 * load `DbManagerFun.cpp:GetTaskBar:984`). We store the same grid as JSON --
 * an array of non-empty `{ i, j, dwShortcut, dwId, dwType, dwIndex, dwUserId,
 * dwData, szString? }` entries (empty slots are omitted, matching the C++ save
 * which skips `SHORTCUT_NONE`). Nullable: a fresh character has no row data
 * (null), hydrated to an all-empty grid on JOIN.
 *
 * Only the item taskbar (`m_aSlotItem[8][9]`) ships here -- it is the grid
 * ADDITEMTASKBAR/REMOVEITEMTASKBAR mutate (items / skills / emotes / chat
 * macros). The applet + skill-queue grids have no handlers yet; ponytail:
 * add columns when those land.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.text('taskbar').nullable().defaultTo(null);
  });
}

/**
 * Reverse -- drop the column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('taskbar');
  });
}
