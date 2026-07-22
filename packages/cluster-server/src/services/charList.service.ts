/**
 * Character list service -- resolves an account name to its character roster.
 *
 * @module services/charList.service
 */

import type {
  AccountRepository,
  CharacterRepository,
  CharacterRow,
} from '@flyff/database';

export class CharListService {
  constructor(
    private accountRepo: AccountRepository,
    private charRepo: CharacterRepository,
  ) {}

  /**
   * List all characters owned by `accountName`.
   *
   * Returns an empty array when the account does not exist (the cluster
   * connection-level handoff should have rejected unknown accounts, but we
   * fail closed per rule 03).
   */
  async listByAccount(accountName: string): Promise<CharacterRow[]> {
    const account = await this.accountRepo.findByUsername(accountName);
    if (!account) return [];
    return this.charRepo.findByAccountId(account.id);
  }
}
