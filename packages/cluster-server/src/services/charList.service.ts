/**
 * Character list service -- resolves an account name to its character roster.
 *
 * @module services/charList.service
 */

import type {
  AccountRepository,
  CharacterRepository,
  CharacterRow,
  InventoryRepository,
} from '@flyff/database';

/** First equip slot index = C++ MAX_INVENTORY (Obj.cpp:128); slots >= this are worn parts. */
const MAX_INVENTORY = 42;

/** A character plus the item IDs it has equipped (for the select-screen preview). */
export interface CharacterWithEquip extends CharacterRow {
  equippedItemIds: number[];
}

export class CharListService {
  constructor(
    private accountRepo: AccountRepository,
    private charRepo: CharacterRepository,
    private inventoryRepo: InventoryRepository,
  ) {}

  /**
   * List all characters owned by `accountName`, each with its equipped item IDs
   * so the character-select screen renders gear (C++ `SendPlayerList`).
   *
   * Returns an empty array when the account does not exist (the cluster
   * connection-level handoff should have rejected unknown accounts, but we
   * fail closed per rule 03).
   */
  async listByAccount(accountName: string): Promise<CharacterWithEquip[]> {
    const account = await this.accountRepo.findByUsername(accountName);
    if (!account) return [];
    const chars = await this.charRepo.findByAccountId(account.id);
    return Promise.all(
      chars.map(async (c) => ({
        ...c,
        equippedItemIds: await this.inventoryRepo.findEquippedItemIds(c.id, MAX_INVENTORY),
      })),
    );
  }
}
