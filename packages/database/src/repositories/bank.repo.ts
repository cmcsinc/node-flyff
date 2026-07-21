import type { Knex } from '../types.js';

/**
 * Database row interface for the bank table (account-shared storage).
 */
export interface BankRow {
  id: number;
  account_id: number;
  tab: number;
  slot: number;
  item_id: number;
  quantity: number;
  flags: number;
  durability: number;
  refine: number;
  stats: string | null;
  created_at: Date;
  updated_at: Date;
}

export type BankCreateData = Omit<BankRow, 'id' | 'created_at' | 'updated_at'>;

/**
 * Repository for bank storage. Bank is account-shared (Flyff lore): all
 * characters on one account see the same 3 tabs. Mirrors `InventoryRepository`
 * with a `tab` axis (0..2).
 */
export class BankRepository {
  constructor(private db: Knex) {}

  /** All bank rows across every tab for an account. */
  async findByAccountId(accountId: number): Promise<BankRow[]> {
    return this.db('bank').where({ account_id: accountId }).orderBy('tab', 'asc').orderBy('slot', 'asc');
  }

  async getItem(accountId: number, tab: number, slot: number): Promise<BankRow | null> {
    const rows = await this.db('bank')
      .where({ account_id: accountId, tab, slot })
      .limit(1);
    return rows[0] || null;
  }

  async setItem(
    accountId: number,
    tab: number,
    slot: number,
    itemId: number,
    quantity: number = 1,
    flags: number = 0,
    durability: number = -1,
    refine: number = 0,
    stats?: string | null,
  ): Promise<void> {
    await this.db('bank')
      .insert({
        account_id: accountId,
        tab,
        slot,
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        stats: stats || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['account_id', 'tab', 'slot'])
      .merge({
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        stats: stats || null,
        updated_at: new Date(),
      });
  }

  async removeItem(accountId: number, tab: number, slot: number): Promise<void> {
    await this.db('bank').where({ account_id: accountId, tab, slot }).del();
  }

  async updateQuantity(accountId: number, tab: number, slot: number, quantity: number): Promise<void> {
    await this.db('bank').where({ account_id: accountId, tab, slot }).update({ quantity, updated_at: new Date() });
  }

  /** Account-wide bank penya (accounts.bank_gold, migration 004). */
  async getGold(accountId: number): Promise<number> {
    const row = await this.db('accounts').where({ id: accountId }).select('bank_gold').first();
    return Number(row?.bank_gold ?? 0);
  }

  async setGold(accountId: number, amount: number): Promise<void> {
    await this.db('accounts').where({ id: accountId }).update({ bank_gold: amount });
  }
}
