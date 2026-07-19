/**
 * PlayerManager — O(1) lookup table for live in-world players.
 *
 * Holds `CPlayer` instances keyed by character id. Per rule 05, entries are
 * removed on disconnect — the manager never relies on GC to clean its Map, and
 * callers must `remove()` to release the socket reference a player holds.
 *
 * @module managers/player.manager
 */

import type { CPlayer } from '../entities/player.js';

export class PlayerManager {
  private readonly players = new Map<number, CPlayer>();

  /** Register a live player. Overwrites an existing entry for the same id. */
  add(player: CPlayer): void {
    this.players.set(player.m_idPlayer, player);
  }

  /** O(1) lookup by character id. */
  get(charId: number): CPlayer | undefined {
    return this.players.get(charId);
  }

  /**
   * Remove a player. Returns true if an entry was cleared.
   * The held socket reference is dropped with the player object.
   */
  remove(charId: number): boolean {
    return this.players.delete(charId);
  }

  /** Current live player count. */
  get size(): number {
    return this.players.size;
  }

  /** Snapshot of all live players (zone broadcasts iterate this). */
  all(): CPlayer[] {
    return [...this.players.values()];
  }
}
