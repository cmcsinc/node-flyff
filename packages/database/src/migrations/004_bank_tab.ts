import type { Knex } from '../types';

/**
 * Adds a `tab` axis to the `bank` table (0..2) and account-wide `bank_gold`.
 *
 * v15 bank is 3 tabs * 42 slots. The original `bank` unique was
 * `(account_id, slot)`; with tabs the same slot index repeats per tab, so the
 * unique becomes `(account_id, tab, slot)`. Existing rows default to `tab 0`.
 *
 * `accounts.bank_gold` holds the shared penya stored in the bank (C++
 * `m_dwGoldBank[0]` -- account-shared in this build, the cross-character common
 * case). Single column suffices until per-tab gold separation is needed.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('bank', (table: any) => {
    table.tinyint('tab').unsigned().notNullable().defaultTo(0);
  });
  await db.schema.alterTable('bank', (table: any) => {
    table.dropUnique(['account_id', 'slot']);
  });
  await db.schema.alterTable('bank', (table: any) => {
    table.unique(['account_id', 'tab', 'slot']);
  });
  await db.schema.alterTable('accounts', (table: any) => {
    table.bigInteger('bank_gold').unsigned().notNullable().defaultTo(0);
  });
}

/**
 * Reverse -- drop `tab` + `bank_gold`, restore the original unique.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('bank', (table: any) => {
    table.dropUnique(['account_id', 'tab', 'slot']);
  });
  await db.schema.alterTable('bank', (table: any) => {
    table.unique(['account_id', 'slot']);
    table.dropColumn('tab');
  });
  await db.schema.alterTable('accounts', (table: any) => {
    table.dropColumn('bank_gold');
  });
}
