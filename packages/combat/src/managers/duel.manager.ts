/**
 * DuelManager -- in-memory registry of pending 1v1 duel proposals.
 *
 * Mirrors the C++ per-user `m_tmDuelRequest` (`__HACK_1130`, DPSrvr.cpp:1976 +
 * 2023): a request must be answered within 10 s or it auto-expires. We hold one
 * {@link PendingDuel} per target (dstId) -- a target can only have one pending
 * inbound proposal at a time, matching the C++ single-slot `m_tmDuelRequest`.
 *
 * ACTIVE duels (post-accept) are NOT tracked here -- they live on the
 * `CPlayer.m_idDuelTarget` field pair (A <-> B). This registry only owns the
 * pre-accept proposal: timer + cleanup of stale entries.
 *
 * ponytail: party-duel (`m_idDuelParty`) -- add a parallel registry when party
 * ships; 1v1 + party variants share a target slot on the C++ side.
 *
 * @module managers/duel
 */

/** 10s proposal expiry (`__HACK_1130`, DPSrvr.cpp:2023). */
export const DUEL_REQUEST_TIMEOUT_MS = 10_000;

/**
 * One pending proposal: src challenged dst. `srcObjid`/`dstObjid` cached so the
 * timeout callback can fire DUELNO without re-resolving the players (who may
 * have disconnected by then -- only `srcId` is re-resolved).
 */
export interface PendingDuel {
  readonly srcId: number;
  readonly dstId: number;
  readonly expiresAt: number;
  /** Live timer; cleared on accept/decline/expiry/disconnect. */
  timer: ReturnType<typeof setTimeout>;
}

export class DuelManager {
  /** Keyed by dstId (target). One pending inbound proposal per target. */
  private readonly pending = new Map<number, PendingDuel>();

  hasPending(dstId: number): boolean { return this.pending.has(dstId); }

  getPending(dstId: number): PendingDuel | undefined { return this.pending.get(dstId); }

  addPending(p: PendingDuel): void { this.pending.set(p.dstId, p); }

  /** Remove + clear the timer. Returns the removed entry (or undefined). */
  removePending(dstId: number): PendingDuel | undefined {
    const e = this.pending.get(dstId);
    if (!e) return undefined;
    clearTimeout(e.timer);
    this.pending.delete(dstId);
    return e;
  }

  /**
   * Disconnect hook -- clear ANY pending proposal that references `charId` (as
   * either src or dst). Without this the timer would fire DUELNO at a missing
   * player (harmless log) or keep a ghost entry blocking the target's next
   * inbound (real bug). ponytail: also clear ACTIVE duel flags via the service.
   */
  onDisconnect(charId: number): void {
    const asDst = this.pending.get(charId);
    if (asDst) { clearTimeout(asDst.timer); this.pending.delete(charId); return; }
    for (const [dstId, p] of this.pending) {
      if (p.srcId === charId) { clearTimeout(p.timer); this.pending.delete(dstId); return; }
    }
  }
}
