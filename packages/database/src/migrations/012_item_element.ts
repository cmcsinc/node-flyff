import type { Knex } from '../types';

/**
 * Add element instance-upgrade columns to `inventory_item`.
 *
 * Refine (`+refine`) was already persisted, but the element applied by an
 * enchant card (`m_bItemResist` element type + `m_nResistAbilityOption` level)
 * was not -- an enchanted weapon lost its element on relog. This closes that
 * gap so `EnchantService` (the `PACKETTYPE_ENCHANT` path, `_Common/ItemUpgrade.
 * cpp`) can mutate + persist both fields.
 *
 * `element` is the `SAI79::ePropType` byte (0..5, `_Common/data.h:409`);
 * `element_level` is `m_nResistAbilityOption` (0..20, `_Common/MoverParam.cpp`
 * :3973). Both default 0 (plain item). The JOIN load path (`join.service.
 * loadInventory`) + the CItemElem wire body (`writeCItemElemBody`) already
 * read `InventorySlot.element` / `element_level`, so adding the columns is the
 * only persistence change.
 *
 * ponytail: bank_item element columns -- enchant targets main-bag items only
 * (C++ rejects equipped + bank is a separate container action), so bank items
 * keep default 0 for now.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('inventory_item', (table: any) => {
    table.tinyint('element').unsigned().notNullable().defaultTo(0);
    table.integer('element_level').unsigned().notNullable().defaultTo(0);
  });
}

/**
 * Reverse -- drop the element columns.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('inventory_item', (table: any) => {
    table.dropColumn('element_level');
    table.dropColumn('element');
  });
}
