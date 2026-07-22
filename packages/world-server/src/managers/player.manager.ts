/**
 * PlayerManager -- O(1) lookup table for live in-world players.
 *
 * Holds `CPlayer` instances keyed by character id. Per rule 05, entries are
 * removed on disconnect -- the manager never relies on GC to clean its Map, and
 * callers must `remove()` to release the socket reference a player holds.
 *
 * @module managers/player.manager
 */

import type { CPlayer } from '../entities/player.js';
import { framePacket } from '@flyff/core/net/PacketBuffer.js';

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
   * Case-insensitive lookup by character name. O(n) -- used by chat commands
   * (whisper/summon/teleport/out) that target a player by name. C++ resolves
   * these via `CPlayerDataCenter::GetPlayerId(name)`; with one world process
   * a linear scan of the live set is the equivalent.
   */
  getByName(name: string): CPlayer | undefined {
    const lower = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.m_szName.toLowerCase() === lower) return p;
    }
    return undefined;
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

  /**
   * Write `buf` to a single player's socket. Services use this for targeted
   * chat sends (whisper echo, teleport REPLACE) the same way they use
   * `ZoneManager.broadcastAround` for vicinity fan-out -- the manager owns the
   * socket sink, services never import `net.Socket` (rule 02).
   */
  sendTo(player: CPlayer, buf: Buffer): void {
    // Frame here -- serializers build raw payloads; the 0x5E frame is added at
    // the write boundary (mirrors `sendPacket()`). Raw writes are silent drops.
    player.socket.write(framePacket(buf));
  }

  /**
   * Write `buf` to every live player regardless of zone. Use for server-wide
   * chat (shout, `/sys` notice). C++ fans these via the cache server; in this
   * single-process emulator a straight iteration is the equivalent.
   */
  broadcastAll(buf: Buffer): number {
    const framed = framePacket(buf);
    let n = 0;
    for (const p of this.players.values()) {
      p.socket.write(framed);
      n++;
    }
    return n;
  }
}
