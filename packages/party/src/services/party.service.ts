/**
 * PartyService -- the v19 solo-party state machine + shared EXP split.
 *
 * Mirrors the consent half of `CDPSrvr::OnAddPartyMember/OnRemovePartyMember/
 * OnPartyChangeLeader` (DPSrvr.cpp:790-962) + `CDPCacheSrvr` party routing
 * (DPCacheSrvr.cpp). Real Flyff round-trips party state via CoreServer; this
 * emulator is single-world so all members live in one `PlayerManager` and the
 * CoreServer hops collapse to direct in-process calls.
 *
 * Sends: every notification is a member-loop `playerManager.sendTo` (no
 * `broadcastAround` helper fits -- a roster can span zones). Party chat, the
 * full roster broadcast (PARTYMEMBER), the leader-change notice, and the
 * invite popup/cancel all flow through here.
 *
 * ponytail: guild-party (`m_nKindTroup=1` + party name + level/exp bar +
 * contribution mode + party skills), party-duel, round-robin item distribution,
 * party finder, party map ping, mute check on party chat, persistence (none --
 * parties are ephemeral, matching C++).
 *
 * @module services/party
 */

import type { CPlayer, CMover } from '@flyff/entities';
import { NULL_ID } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import {
  buildPartyMember, buildPartyRequest, buildPartyRequestCancel,
  buildPartyChangeLeader, buildPartyChat, buildSetNaviPoint,
  type PartySnapshotMember,
} from '@flyff/world-core';
import {
  PartyManager, PARTY_INVITE_TIMEOUT_MS,
} from '../managers/party.manager';
import { createLogger } from '@flyff/core/logger';
import type { Party } from '../managers/party.manager';

const logger = createLogger({ module: 'party-service' });

/** Shared-EXP proximity gate -- members within 64m of the dead mover share. */
const PARTY_EXP_PROXIMITY = 64;
/** Level gate: members must be within 20 levels of the highest nearby member. */
const PARTY_EXP_LEVEL_BAND = 20;
/** Bonus factor per C++ `AddExperiencePartyLevel` (Mover.cpp:6525): 0.2 per extra member. */
const PARTY_EXP_BONUS_PER_MEMBER = 0.2;

export interface PartyServiceDeps {
  playerManager: PlayerManager;
  partyManager: PartyManager;
  /**
   * Per-player exp applier -- delegates to `CombatService.grantExpAmount` so
   * there is ONE exp-application code path (within-level addExp cascade +
   * WAL + SETEXPERIENCE + SETLEVEL + persist). Structural type -- closure
   * satisfies the signature, keeps party free of any `@flyff/combat` import.
   */
  grantExpAmount: (player: CPlayer, amount: number) => void;
  /** Injector seam for tests. */
  now?: () => number;
}

export class PartyService {
  private readonly now: () => number;
  constructor(private readonly deps: PartyServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Leader invites `memberId`. Guards: requester is the leader of an existing
   * party (or solo with no party yet), party not full (<8), target not already
   * in a party, no pending invite on target. Sends PARTYREQEST popup to target.
   */
  invite(leader: CPlayer, memberId: number): void {
    if (leader.m_idPlayer === memberId) return;
    if (this.deps.partyManager.hasPending(memberId)) return;
    const existing = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (existing && existing.members[0] !== leader.m_idPlayer) return; // not leader
    if (existing && existing.members.length >= 8) return;
    const target = this.deps.playerManager.get(memberId);
    if (!target) return;
    if (this.deps.partyManager.getByMember(memberId)) return;
    const timer = setTimeout(() => this.expireInvite(memberId), PARTY_INVITE_TIMEOUT_MS);
    this.deps.partyManager.addPending({
      leaderId: leader.m_idPlayer, memberId, expiresAt: this.now() + PARTY_INVITE_TIMEOUT_MS, timer,
    });
    this.deps.playerManager.sendTo(target, buildPartyRequest(
      target.m_idPlayer,
      leader.m_idPlayer, leader.m_nLevel, leader.m_nJob, leader.m_nSex,
      target.m_idPlayer, target.m_nLevel, target.m_nJob, target.m_nSex,
      leader.m_szName, 0,
    ));
  }

  /** Auto-expire the pending invite (30s elapsed). */
  private expireInvite(memberId: number): void {
    const p = this.deps.partyManager.removePending(memberId);
    if (!p) return;
    const leader = this.deps.playerManager.get(p.leaderId);
    if (leader) {
      this.deps.playerManager.sendTo(leader, buildPartyRequestCancel(leader.m_idPlayer, p.leaderId, memberId, 0));
    }
  }

  /**
   * Target accepts the pending invite from `leaderId`. Creates a fresh party
   * (2 members) if the leader had none, else `addMember`. Sets `m_idParty` on
   * every member and broadcasts the full PARTYMEMBER roster to each.
   */
  accept(member: CPlayer, leaderId: number): void {
    const p = this.deps.partyManager.getPending(member.m_idPlayer);
    if (!p || p.leaderId !== leaderId) return;
    const leader = this.deps.playerManager.get(leaderId);
    if (!leader) { this.deps.partyManager.removePending(member.m_idPlayer); return; }
    this.deps.partyManager.removePending(member.m_idPlayer);
    let party = this.deps.partyManager.getByMember(leaderId);
    if (!party) {
      party = this.deps.partyManager.create(leaderId, member.m_idPlayer);
    } else {
      const added = this.deps.partyManager.addMember(party.id, member.m_idPlayer);
      if (!added) return;
      party = added;
    }
    leader.m_idParty = party.id;
    member.m_idParty = party.id;
    this.broadcastRoster(party, leader, member);
  }

  /** Target declines. Clear pending + PARTYREQESTCANCEL(nMode=0) to leader. */
  decline(member: CPlayer): void {
    const p = this.deps.partyManager.removePending(member.m_idPlayer);
    if (!p) return;
    const leader = this.deps.playerManager.get(p.leaderId);
    if (leader) {
      this.deps.playerManager.sendTo(
        leader, buildPartyRequestCancel(leader.m_idPlayer, p.leaderId, member.m_idPlayer, 0),
      );
    }
  }

  /**
   * Leave (requester==target) or kick (requester is leader). On the leader
   * leaving, auto-promote `members[0]`. Below 2 members -> disband (clear
   * `m_idParty` on remaining + send empty PARTYMEMBER).
   */
  leaveOrKick(requester: CPlayer, targetId: number): void {
    const party = this.deps.partyManager.getByMember(requester.m_idPlayer);
    if (!party) return;
    const wasRequesterLeader = party.members[0] === requester.m_idPlayer;
    if (requester.m_idPlayer !== targetId && !wasRequesterLeader) return; // kick = leader-only
    const target = this.deps.playerManager.get(targetId);
    const wasTargetLeader = party.members[0] === targetId;
    const res = this.deps.partyManager.removeMember(party.id, targetId);
    if (target) target.m_idParty = NULL_ID;
    if (!res.party) return;
    if (res.disbanded) {
      this.notifyDisband(res.party);
      return;
    }
    if (wasTargetLeader) {
      // Leader left -> members[0] is already the auto-promoted new leader.
      const newLeaderId = res.party.members[0];
      this.broadcastAddPartyChangeLeader(res.party, newLeaderId);
    }
    this.broadcastRosterOnly(res.party);
  }

  /** Leader-only: promote `targetId` into slot 0 + ADDPARTYCHANGELEADER. */
  changeLeader(leader: CPlayer, targetId: number): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    const updated = this.deps.partyManager.promoteLeader(party.id, targetId);
    if (!updated) return;
    this.broadcastAddPartyChangeLeader(updated, targetId);
    this.broadcastRosterOnly(updated);
  }

  /** Leader-only: change exp share mode. (Re-broadcasts roster so UI refreshes.) */
  changeExpMode(leader: CPlayer, mode: number): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    party.expMode = mode;
    this.broadcastRosterOnly(party);
  }

  /** Leader-only: change item share mode (FFA <-> round-robin). */
  changeItemMode(leader: CPlayer, mode: number): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    party.itemMode = mode;
    this.broadcastRosterOnly(party);
  }

  /** Member-loop PARTYCHAT to every party member. ponytail: mute check. */
  chat(sender: CPlayer, msg: string): void {
    const party = this.deps.partyManager.getByMember(sender.m_idPlayer);
    if (!party) return;
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (p) this.deps.playerManager.sendTo(p, buildPartyChat(p.m_idPlayer, sender.m_szName, msg, sender.m_idPlayer));
    }
  }

  /**
   * SETNAVIPOINT -- navigator map ping. Ports `CDPSrvr::OnSetNaviPoint`
   * (DPSrvr.cpp:6641) exactly:
   *   - `targetId === NULL_ID` -> fan out to every member of the pinger's
   *     party (nothing happens if they have no party; the client already gates
   *     this branch on `g_Party.IsMember`).
   *   - otherwise -> a direct ping at one focused player: BOTH the pinger and
   *     that player get the marker, regardless of party membership.
   * The marker record's objid is the PINGER's id in both branches -- the client
   * keys `m_vOtherPoint` by it (`DPClient.cpp:15358`), so sending the recipient
   * id would make every pinger overwrite the same single marker.
   */
  naviPoint(sender: CPlayer, pos: { x: number; y: number; z: number }, targetId: number): void {
    const marker = (): Buffer => buildSetNaviPoint(sender.m_idPlayer, pos, sender.m_szName);
    if (targetId === NULL_ID) {
      const party = this.deps.partyManager.getByMember(sender.m_idPlayer);
      if (!party) return;
      for (const id of party.members) {
        const p = this.deps.playerManager.get(id);
        if (p) this.deps.playerManager.sendTo(p, marker());
      }
      return;
    }
    const target = this.deps.playerManager.get(targetId);
    if (!target) return;
    this.deps.playerManager.sendTo(sender, marker());
    if (target.m_idPlayer !== sender.m_idPlayer) this.deps.playerManager.sendTo(target, marker());
  }

  /**
   * Disconnect seam -- clear pending invites AND remove from any active party.
   * Caller passes the live player so we can clear `m_idParty` before the join
   * service drops the player from the manager. Mirrors leave: auto-promote if
   * the leader dropped, disband if <2 remain.
   */
  onDisconnect(player: CPlayer): void {
    const res = this.deps.partyManager.onDisconnect(player.m_idPlayer);
    player.m_idParty = NULL_ID;
    if (!res.party) return;
    if (res.disbanded) { this.notifyDisband(res.party); return; }
    if (res.wasLeader) {
      const newLeaderId = res.party.members[0];
      this.broadcastAddPartyChangeLeader(res.party, newLeaderId);
    }
    this.broadcastRosterOnly(res.party);
  }

  /**
   * `AddExperiencePartyLevel` (Mover.cpp:6503-6546) + proximity gate (6184-6218).
   * Collects party members within 64m of the dead mover, applies the level band
   * gate (>maxLv-20), splits `(base + bonus) * (lv² / Σlv²)` per member, and
   * applies each member's share via the shared `grantExpAmount` seam. Returns
   * the count of members who received exp (null if `killer` has no party).
   */
  distributeExp(killer: CPlayer, mover: CMover, baseExp: number): number | null {
    const party = this.deps.partyManager.getByMember(killer.m_idPlayer);
    if (!party) return null;
    const nearby: CPlayer[] = [];
    let maxLevel = 0;
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      if (p.m_nZoneId !== mover.m_nZoneId) continue;
      if (distSqXZ(p.m_vPos, mover.m_vPos) > PARTY_EXP_PROXIMITY * PARTY_EXP_PROXIMITY) continue;
      nearby.push(p);
      if (p.m_nLevel > maxLevel) maxLevel = p.m_nLevel;
    }
    if (nearby.length === 0) return 0;
    const eligible = nearby.filter((p) => p.m_nLevel > maxLevel - PARTY_EXP_LEVEL_BAND);
    if (eligible.length === 0) return 0;
    const bonus = baseExp * PARTY_EXP_BONUS_PER_MEMBER * (eligible.length - 1);
    const total = baseExp + bonus;
    let levelSqSum = 0;
    for (const p of eligible) levelSqSum += p.m_nLevel * p.m_nLevel;
    if (levelSqSum <= 0) return 0;
    let granted = 0;
    for (const p of eligible) {
      const share = Math.floor(total * (p.m_nLevel * p.m_nLevel) / levelSqSum);
      if (share > 0) { this.deps.grantExpAmount(p, share); granted++; }
    }
    logger.debug({ partyId: party.id, killer: killer.m_idPlayer, base: baseExp, granted }, 'party exp split');
    return granted;
  }

  // --- Roster broadcast helpers ---------------------------------------------

  /** Send the full PARTYMEMBER roster to every member (after a roster change). */
  private broadcastRoster(party: Party, leader: CPlayer, newMember: CPlayer): void {
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      const snapshotMembers: PartySnapshotMember[] = party.members.map((m) => ({ id: m, remove: false }));
      const snapshot = {
        partyId: party.id, size: party.members.length, expMode: party.expMode,
        itemMode: party.itemMode, duelPartyId: NULL_ID, members: snapshotMembers,
      };
      this.deps.playerManager.sendTo(
        p, buildPartyMember(p.m_idPlayer, leader.m_szName, newMember.m_szName, snapshot),
      );
    }
  }

  /** Roster refresh (no joiner context) -- uses leader's name for both fields. */
  private broadcastRosterOnly(party: Party): void {
    const leader = this.deps.playerManager.get(party.members[0]);
    if (!leader) return;
    const memberName = (this.deps.playerManager.get(party.members[party.members.length - 1]) ?? leader).m_szName;
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      const snapshotMembers: PartySnapshotMember[] = party.members.map((m) => ({ id: m, remove: false }));
      const snapshot = {
        partyId: party.id, size: party.members.length, expMode: party.expMode,
        itemMode: party.itemMode, duelPartyId: NULL_ID, members: snapshotMembers,
      };
      this.deps.playerManager.sendTo(p, buildPartyMember(p.m_idPlayer, leader.m_szName, memberName, snapshot));
    }
  }

  /** Disband -- send an empty PARTYMEMBER (size 0) to each remaining member. */
  private notifyDisband(party: Party): void {
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      p.m_idParty = NULL_ID;
      this.deps.playerManager.sendTo(p, buildPartyMember(p.m_idPlayer, '', '', null));
    }
  }

  private broadcastAddPartyChangeLeader(party: Party, newLeaderId: number): void {
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      this.deps.playerManager.sendTo(p, buildPartyChangeLeader(p.m_idPlayer, newLeaderId));
    }
  }
}

interface Vec3 { x: number; y: number; z: number }
/** Horizontal (XZ) squared distance -- proximity gate ignores height. */
function distSqXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
