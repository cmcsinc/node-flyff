/**
 * DestPollService -- keep a walking player's server-side position fresh.
 *
 * While a client auto-walks to a *destination object* (`PLAYERSETDESTOBJ`:
 * follow a player, approach a mob, walk to an NPC or a ground pile) it sends NO
 * movement packet at all -- the walk is driven entirely by its own
 * `CMover::ProcessMove`. The C++ world server does not care because it simulates
 * the walk itself; this emulator is client-authoritative for position, so
 * `m_vPos` would stay pinned at the click point for the whole walk and every
 * distance gate (party exp/item proximity, skill cast range, loot arrival,
 * vicinity streaming) would read a stale position.
 *
 * The vanilla mechanism for exactly this is `SNAPSHOTTYPE_QUERYGETPOS`:
 * `CMover::OnActArrival` / `OnActCollision` (`_Common/MoverActEvent.cpp:2015`,
 * `:2085`) take the `IsPlayer()` branch on `__WORLDSERVER` and call
 * `AddQueryGetPos( NULL_ID )` whenever the player has a non-empty destination.
 * The client answers `PACKETTYPE_GETPOS` (`DPClient.cpp:9000`), which lands in
 * `MovementService.applyGetPos` -> position update + `LootService.checkArrival`.
 *
 * C++ gates the ask on `m_fWaitQueryGetPos` (one request outstanding) and fires
 * it off act-events rather than a timer. We poll on a fixed interval instead --
 * we have no act-event tick -- and deliberately do NOT model the flag: at this
 * cadence a single dropped reply would otherwise stall the poll permanently.
 *
 * ponytail: delete this service once `CMover::ProcessMove`/`ProcessMoveArrival`
 * are ported and the server walks the player itself.
 *
 * @module services/destPoll.service
 */

import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { NULL_ID, buildQueryGetPos } from '@flyff/world-core';

/**
 * Poll cadence. 250ms is ~4 position samples per second: tight enough that a
 * running player never drifts more than a few units past a 32-unit proximity
 * gate, loose enough to be negligible traffic (one 22-byte snapshot per walker).
 */
export const DEST_POLL_MS = 250;
/**
 * Hard cap on a single arm. A follow re-arms this on every hop (the client
 * re-sends `PLAYERSETDESTOBJ` whenever the leader is further than
 * `distSq > 16`, `WndWorldControlPlayer.cpp:405-416`), so a live follow keeps
 * polling indefinitely; the cap only stops a poll whose dest went stale without
 * the server noticing (client crashed mid-walk, stopped short of the target).
 */
export const DEST_POLL_TIMEOUT_MS = 60_000;

export interface DestPollServiceDeps {
  playerManager: PlayerManager;
  /** Injector seam for tests; defaults to `Date.now`. */
  now?: () => number;
}

export class DestPollService {
  private readonly polls = new Map<number, NodeJS.Timeout>();
  private readonly now: () => number;

  constructor(private readonly deps: DestPollServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Start (or restart) polling `player` for its position because it has a
   * destination object it has not reached. No-op when the dest is already clear.
   */
  arm(player: CPlayer): void {
    const charId = player.m_idPlayer;
    if (player.m_idDestObj === NULL_ID) { this.cancel(charId); return; }
    this.cancel(charId);
    const deadline = this.now() + DEST_POLL_TIMEOUT_MS;
    // The timer holds the char id, never the CPlayer, and re-resolves through
    // PlayerManager each tick so a disconnected player cannot be pinned in
    // memory by this interval (rule 05).
    const timer = setInterval(() => {
      const p = this.deps.playerManager.get(charId);
      if (!p || p.m_idDestObj === NULL_ID || this.now() > deadline) {
        this.cancel(charId);
        return;
      }
      // idFrom = NULL_ID: the client echoes it back as `objid` in GETPOS, and
      // `OnGetPos` (`DPSrvr.cpp:1463`) only takes the position as the sender's
      // own when `objid == NULL_ID`.
      this.deps.playerManager.sendTo(p, buildQueryGetPos(charId, NULL_ID));
    }, DEST_POLL_MS);
    timer.unref();
    this.polls.set(charId, timer);
  }

  /** Stop polling one player (dest cleared, arrived, disconnected). */
  cancel(charId: number): void {
    const t = this.polls.get(charId);
    if (t) { clearInterval(t); this.polls.delete(charId); }
  }

  /** Stop every poll (world shutdown -- rule 05, no timer outlives the process). */
  shutdown(): void {
    for (const t of this.polls.values()) clearInterval(t);
    this.polls.clear();
  }

  /** Live poll count (tests / diagnostics). */
  get size(): number {
    return this.polls.size;
  }
}
