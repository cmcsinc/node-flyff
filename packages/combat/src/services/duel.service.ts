/**
 * DuelService -- 1v1 consented PvP state machine.
 *
 * Ports the consent half of `CDPSrvr::OnDuelRequest/Yes/No` (DPSrvr.cpp:1935/
 * 1985/2046). The damage pipeline itself is the normal `CombatService` flow;
 * this service only owns the proposal timer, the mutual-flag flip on accept,
 * and the teardown on decline/expire/death/disconnect.
 *
 * Lifecycle (mirrors C++ `m_nDuel` / `m_idDuelOther`):
 *   REQUEST A->B  : DuelManager records pending(dstId, +10s); send DUELREQUEST to B.
 *   YES from B    : set A.m_idDuelTarget=B, B.m_idDuelTarget=A, both m_nDuel=1;
 *                   broadcast SETDUEL + DUELSTART to both.
 *   NO / expire   : clear pending; DUELNO to A.
 *   death(A|B)    : DUELCANCEL to both; clear both flags (m_nDuel=0, target=NULL_ID).
 *   disconnect    : same as death, plus clear any pending that references the player.
 *
 * ponytail: party-duel (`m_idDuelParty` + DUELPARTYREQUEST 0xffffff26-28),
 * ranked DUELCOUNT, loot protection. 1v1 MVP only.
 *
 * @module services/duel
 */

import type { CPlayer } from '@flyff/entities';
import { NULL_ID } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import {
  buildDuelRequest, buildDuelStart, buildDuelNo, buildDuelCancel, buildSetDuel,
} from '@flyff/world-core';
import { DuelManager, DUEL_REQUEST_TIMEOUT_MS } from '../managers/duel.manager';

/** SETDUEL `nDuelState` value used on accept -- C++ sets 104 (active). */
const DUEL_STATE_ACTIVE = 104;

export interface DuelServiceDeps {
  playerManager: PlayerManager;
  duelManager: DuelManager;
  /** Injector seam for tests. */
  now?: () => number;
}

export class DuelService {
  private readonly now: () => number;
  constructor(private readonly deps: DuelServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** A challenges B (dstId). Guards: A or B already dueling; B already has pending. */
  request(src: CPlayer, dstId: number): void {
    if (src.m_idDuelTarget !== NULL_ID) return; // already dueling
    const dst = this.deps.playerManager.get(dstId);
    if (!dst || dst.m_idDuelTarget !== NULL_ID) return;
    if (this.deps.duelManager.hasPending(dstId)) return;
    const srcId = src.m_idPlayer;
    const timer = setTimeout(() => this.expire(dstId), DUEL_REQUEST_TIMEOUT_MS);
    this.deps.duelManager.addPending({ srcId, dstId, expiresAt: this.now() + DUEL_REQUEST_TIMEOUT_MS, timer });
    this.deps.playerManager.sendTo(dst, buildDuelRequest(dst.m_idPlayer, srcId, dstId));
  }

  /** B accepts. Clears pending + flips both flags + SETDUEL/DUELSTART to both. */
  accept(dst: CPlayer, srcId: number): void {
    const p = this.deps.duelManager.getPending(dst.m_idPlayer);
    if (!p || p.srcId !== srcId) return;
    const src = this.deps.playerManager.get(srcId);
    if (!src || src.m_idDuelTarget !== NULL_ID) { this.deps.duelManager.removePending(dst.m_idPlayer); return; }
    this.deps.duelManager.removePending(dst.m_idPlayer);
    src.m_idDuelTarget = dst.m_idPlayer;
    src.m_nDuel = 1;
    dst.m_idDuelTarget = src.m_idPlayer;
    dst.m_nDuel = 1;
    // SETDUEL flips the client flag + records the peer objid; DUELSTART opens the UI.
    this.deps.playerManager.sendTo(src, buildSetDuel(src.m_idPlayer, src.m_idPlayer, 1, DUEL_STATE_ACTIVE, dst.m_idPlayer));
    this.deps.playerManager.sendTo(dst, buildSetDuel(dst.m_idPlayer, dst.m_idPlayer, 1, DUEL_STATE_ACTIVE, src.m_idPlayer));
    this.deps.playerManager.sendTo(src, buildDuelStart(src.m_idPlayer, dst.m_idPlayer, 0));
    this.deps.playerManager.sendTo(dst, buildDuelStart(dst.m_idPlayer, src.m_idPlayer, 0));
  }

  /** B declines (or auto-expire). DUELNO to A. */
  decline(dst: CPlayer, srcId: number): void {
    const p = this.deps.duelManager.getPending(dst.m_idPlayer);
    if (!p || p.srcId !== srcId) return;
    this.deps.duelManager.removePending(dst.m_idPlayer);
    const src = this.deps.playerManager.get(srcId);
    if (src) this.deps.playerManager.sendTo(src, buildDuelNo(src.m_idPlayer, dst.m_idPlayer));
  }

  /** B declines the inbound proposal without naming srcId (DUELNO body carries
   * only `uidSrc`). Resolves srcId from the single pending slot on dst. */
  declineByTarget(dst: CPlayer): void {
    const p = this.deps.duelManager.getPending(dst.m_idPlayer);
    if (!p) return;
    this.decline(dst, p.srcId);
  }

  /** Auto-expire the pending proposal (10s elapsed). */
  expire(dstId: number): void {
    const p = this.deps.duelManager.removePending(dstId);
    if (!p) return;
    const src = this.deps.playerManager.get(p.srcId);
    const dst = this.deps.playerManager.get(dstId);
    if (src && dst) this.deps.playerManager.sendTo(src, buildDuelNo(src.m_idPlayer, dstId));
  }

  /** CombatService.onPvpKill seam -- clear both sides on lethal blow. */
  onPlayerDeath(victim: CPlayer): void {
    const peerId = victim.m_idDuelTarget;
    if (peerId === NULL_ID) return;
    const peer = this.deps.playerManager.get(peerId);
    victim.m_idDuelTarget = NULL_ID;
    victim.m_nDuel = 0;
    if (peer) {
      peer.m_idDuelTarget = NULL_ID;
      peer.m_nDuel = 0;
      this.deps.playerManager.sendTo(peer, buildDuelCancel(peer.m_idPlayer, victim.m_idPlayer));
    }
    this.deps.playerManager.sendTo(victim, buildDuelCancel(victim.m_idPlayer, peerId));
  }

  /** Disconnect seam -- clear pending + active flags. */
  onDisconnect(player: CPlayer): void {
    this.deps.duelManager.onDisconnect(player.m_idPlayer);
    if (player.m_idDuelTarget !== NULL_ID) this.onPlayerDeath(player);
  }
}
