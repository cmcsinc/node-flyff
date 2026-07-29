import type { Knex } from '../types';

/**
 * One live-session row of `online_players` (migration `017`).
 *
 * No C++ analogue — vanilla keeps presence in `CUserMng` memory, which a
 * separate admin process cannot read. The world server owns these rows:
 * upsert on JOIN, delete on disconnect, `last_seen_ms` bumped by the 30 s
 * checkpoint pass.
 */
export interface PresenceRow {
  readonly character_id: number;
  readonly account_id: number;
  /** World the character is in (`characters.world_id`). */
  readonly world_id: string;
  readonly zone_id: number;
  /** Which world-server process owns the session (for crash cleanup). */
  readonly server_id: string;
  /** Epoch ms of the last heartbeat; freshness decides "online". */
  readonly last_seen_ms: number;
}

/** Write-side shape for {@link PresenceRepository.upsert} — `last_seen_ms` is set by the repo. */
export interface PresenceUpsertData {
  readonly character_id: number;
  readonly account_id: number;
  readonly world_id: string;
  readonly zone_id: number;
  readonly server_id: string;
}

/**
 * Repository for the live-session registry.
 *
 * All methods use the Knex query builder (no raw SQL). One row per online
 * character, keyed by `character_id` (the table's primary key), so `upsert` is
 * idempotent for a re-JOIN on the same character.
 *
 * Readers must treat a row as online only while `last_seen_ms` is fresh —
 * see {@link PresenceRepository.listOnline}. A crashed world leaves stale rows
 * that expire on their own; {@link PresenceRepository.clearByServer} removes
 * them eagerly at the next boot of that server.
 */
export class PresenceRepository {
  constructor(private db: Knex) {}

  /**
   * Insert or refresh a character's presence row, stamping `last_seen_ms` with
   * the current clock.
   *
   * @param row - Session identity (character, account, world, zone, server)
   * @param nowMs - Reference clock (defaults to `Date.now()`); injectable for tests
   */
  async upsert(row: PresenceUpsertData, nowMs = Date.now()): Promise<void> {
    await this.db('online_players')
      .insert({ ...row, last_seen_ms: nowMs })
      .onConflict('character_id')
      .merge({
        account_id: row.account_id,
        world_id: row.world_id,
        zone_id: row.zone_id,
        server_id: row.server_id,
        last_seen_ms: nowMs,
      });
  }

  /**
   * Delete a character's presence row (clean disconnect).
   *
   * @param characterId - Character ID
   */
  async remove(characterId: number): Promise<void> {
    await this.db('online_players').where({ character_id: characterId }).del();
  }

  /**
   * Bump `last_seen_ms` only (checkpoint heartbeat). No-op when the character
   * has no row — presence is created by {@link PresenceRepository.upsert}.
   *
   * @param characterId - Character ID
   * @param nowMs - Reference clock (defaults to `Date.now()`)
   */
  async touch(characterId: number, nowMs = Date.now()): Promise<void> {
    await this.db('online_players')
      .where({ character_id: characterId })
      .update({ last_seen_ms: nowMs });
  }

  /**
   * All characters whose heartbeat is still fresh.
   *
   * @param staleMs - Freshness window in ms (default 60 s = 2× the checkpoint period)
   * @param nowMs - Reference clock (defaults to `Date.now()`)
   * @returns Fresh presence rows (empty if nobody is online)
   */
  async listOnline(staleMs = 60_000, nowMs = Date.now()): Promise<PresenceRow[]> {
    const rows: PresenceRow[] = await this.db('online_players')
      .where('last_seen_ms', '>', nowMs - staleMs);
    return rows;
  }

  /**
   * Drop every row owned by one world-server process. Called at world boot so a
   * crashed previous run's sessions disappear immediately instead of lingering
   * for the whole freshness window.
   *
   * @param serverId - Owning world-server identity
   */
  async clearByServer(serverId: string): Promise<void> {
    await this.db('online_players').where({ server_id: serverId }).del();
  }
}
