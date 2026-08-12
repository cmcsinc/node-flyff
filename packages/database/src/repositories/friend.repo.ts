import type { Knex } from '../types';

/** `MAX_FRIEND` (`_Common/messenger.h:20`) -- roster cap per character. */
export const MAX_FRIEND = 200;

/**
 * One row of `friends` (migration `019`) -- a directed roster edge.
 *
 * C++ `Friend { BOOL bBlock; DWORD dwState; }` (`_Common/rtmessenger.h:6`), but
 * only `bBlock` persists: `dwState` is live presence, recomputed from who is
 * connected (`DPCacheSrvr.cpp:331-364`).
 */
export interface FriendRow {
  readonly id: number;
  readonly character_id: number;
  readonly friend_id: number;
  readonly blocked: boolean;
  readonly created_at_ms: number;
}

/**
 * FriendRepository -- the `friends` table plus `characters.messenger_state`.
 *
 * Mirrors the C++ persistence surface, which lives on the CORE server rather
 * than the world one: `CDbManager::LoadMessenger` (`_Database/DbManager.cpp
 * :7791`, `uspLoadMessenger` -> `idFriend` + `bBlock`) for load, and the
 * incremental `QueryAddMessenger` / `QueryDeleteMessenger` /
 * `QueryUpdateMessenger` calls (`CORESERVER/DPDatabaseClient.cpp:574-592`) for
 * writes. There is no bulk save -- every mutation is written through
 * immediately, which is what {@link add} / {@link remove} / {@link setBlocked}
 * do here.
 *
 * `add` / `remove` write BOTH directions in one transaction: `OnAddFriend`
 * (`CORESERVER/DPCacheSrvr.cpp:2012-2016`) and `OnRemoveFriend` (`:2204/2213`)
 * always mutate both rosters, so a half-applied pair would leave one side
 * seeing a friend the other does not.
 *
 * @module database/repositories/friend
 */
export class FriendRepository {
  constructor(private readonly db: Knex) {}

  /** Every edge owned by `characterId`, oldest first. */
  async loadByCharacter(characterId: number): Promise<FriendRow[]> {
    const rows: FriendRow[] = await this.db('friends')
      .where({ character_id: characterId })
      .orderBy('created_at_ms', 'asc')
      .select('*');
    return rows;
  }

  /** One edge, or `undefined` when they are not friends. */
  async get(characterId: number, friendId: number): Promise<FriendRow | undefined> {
    const row: FriendRow | undefined = await this.db('friends')
      .where({ character_id: characterId, friend_id: friendId })
      .first();
    return row;
  }

  /** Roster size for the `MAX_FRIEND` gate. */
  async count(characterId: number): Promise<number> {
    const row = await this.db('friends')
      .where({ character_id: characterId })
      .count({ n: '*' })
      .first();
    return Number(row?.n ?? 0);
  }

  /**
   * Insert the symmetric pair. Idempotent -- an existing edge is left alone, so
   * a duplicate accept cannot double-insert or reset `blocked`.
   */
  async add(a: number, b: number, nowMs = Date.now()): Promise<void> {
    await this.db.transaction(async (trx: Knex) => {
      for (const [owner, friend] of [[a, b], [b, a]] as const) {
        const existing = await trx('friends')
          .where({ character_id: owner, friend_id: friend })
          .first();
        if (existing) continue;
        await trx('friends').insert({
          character_id: owner, friend_id: friend,
          blocked: false, created_at_ms: nowMs,
        });
      }
    });
  }

  /** Delete the symmetric pair (friendship removal is mutual in C++). */
  async remove(a: number, b: number): Promise<void> {
    await this.db.transaction(async (trx: Knex) => {
      await trx('friends').where({ character_id: a, friend_id: b }).del();
      await trx('friends').where({ character_id: b, friend_id: a }).del();
    });
  }

  /** Set the per-direction block flag (`Friend::bBlock`). */
  async setBlocked(characterId: number, friendId: number, blocked: boolean): Promise<void> {
    await this.db('friends')
      .where({ character_id: characterId, friend_id: friendId })
      .update({ blocked });
  }

  /** The owner's own `FRS_*` status (`CRTMessenger::m_dwState`). */
  async getState(characterId: number): Promise<number> {
    const row = await this.db('characters')
      .where({ id: characterId })
      .first('messenger_state');
    return Number(row?.messenger_state ?? 0);
  }

  /** Persist the owner's own `FRS_*` status. */
  async setState(characterId: number, state: number): Promise<void> {
    await this.db('characters').where({ id: characterId }).update({ messenger_state: state });
  }
}
