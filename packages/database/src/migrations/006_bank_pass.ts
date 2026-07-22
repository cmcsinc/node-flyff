import type { Knex } from '../types.js';

/**
 * Per-character bank password (`characters.bank_pass`).
 *
 * C++ `CUser::m_szBankPass` (char[5], `User.cpp:149` memset 0; loaded
 * `DPDatabaseClient.cpp:779` `ReadString(...,5)`). The sentinel `"0000"` means
 * "no password set" -- `OnOpenBankWnd:3218` opens the bank directly when it
 * matches, else prompts CONFIRMBANK. Max 4 chars (`OnChangeBankPass:3965`
 * rejects `strlen > 4`). Stored plaintext to mirror the original protocol.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.string('bank_pass', 10).notNullable().defaultTo('0000');
  });
}

/**
 * Reverse -- drop the column.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('characters', (table: any) => {
    table.dropColumn('bank_pass');
  });
}
