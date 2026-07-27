/**
 * PartyManager -- in-memory registry of live parties + pending invites.
 *
 * Mirrors `CPartyMng` (`_Common/party.cpp`): auto-increment party ids, a
 * {@link Party} per active id, and one pending inbound invite per target
 * member. Parties are purely ephemeral session state (no DB row -- matches
 * C++ where CParty lives in CoreServer RAM, never the character row). Rule 04
 * excludes ephemeral social state from the WAL journal.
 *
 * Roster invariant: `members[0]` is always the current leader (C++ keeps the
 * leader at slot 0 via `SwapPartyMember(0, idx)` in `CParty::ChangeLeader`).
 *
 * ponytail: party-duel (`m_idDuelParty`), guild-party (`m_nKindTroup=1` +
 * party name + party-level + contribution mode + skills). Solo party only.
 *
 * @module managers/party
 */

/** Exp-mode constants (`m_nTroupsShareExp`). Solo party uses level-split. */
export const PARTY_EXP_MODE_LEVEL = 0;
/** Item-mode constants (`m_nTroupeShareItem`). 0 = FFA, 1 = round-robin. */
export const PARTY_ITEM_MODE_FFA = 0;
export const PARTY_ITEM_MODE_ROUND_ROBIN = 1;

/** 30s invite expiry -- generous C++ has no hard TTL; matches duel pattern. */
export const PARTY_INVITE_TIMEOUT_MS = 30_000;

/** Max members in a solo party (mirrors C++ `MAX_PARYMEMBER` default). */
export const MAX_PARTY_MEMBERS = 8;

/** One live party. `members[0]` is the leader. */
export interface Party {
  readonly id: number;
  /** Character ids; index 0 is always the leader. */
  members: number[];
  /** `m_nTroupsShareExp` (0 = level-based split). */
  expMode: number;
  /** `m_nTroupeShareItem` (0 FFA, 1 round-robin). */
  itemMode: number;
  /** Round-robin looter cursor (next member index). */
  roundRobinIdx: number;
}

/** One pending inbound invite targeting `memberId`. */
export interface PendingPartyInvite {
  readonly leaderId: number;
  readonly memberId: number;
  readonly expiresAt: number;
  /** Live timer; cleared on accept/decline/expiry/disconnect. */
  timer: ReturnType<typeof setTimeout>;
}

export class PartyManager {
  private readonly parties = new Map<number, Party>();
  private readonly pending = new Map<number, PendingPartyInvite>();
  private nextId = 1;

  hasPending(memberId: number): boolean { return this.pending.has(memberId); }

  getPending(memberId: number): PendingPartyInvite | undefined {
    return this.pending.get(memberId);
  }

  addPending(p: PendingPartyInvite): void { this.pending.set(p.memberId, p); }

  /** Remove + clear the timer. Returns the removed entry (or undefined). */
  removePending(memberId: number): PendingPartyInvite | undefined {
    const e = this.pending.get(memberId);
    if (!e) return undefined;
    clearTimeout(e.timer);
    this.pending.delete(memberId);
    return e;
  }

  /** Create a fresh party with 2 members (leader at index 0). */
  create(leaderId: number, memberId: number): Party {
    const party: Party = {
      id: this.nextId++,
      members: [leaderId, memberId],
      expMode: PARTY_EXP_MODE_LEVEL,
      itemMode: PARTY_ITEM_MODE_FFA,
      roundRobinIdx: 0,
    };
    this.parties.set(party.id, party);
    return party;
  }

  get(partyId: number): Party | undefined { return this.parties.get(partyId); }

  /** Find the party a character belongs to (linear scan -- rosters are small). */
  getByMember(charId: number): Party | undefined {
    for (const p of this.parties.values()) {
      if (p.members.includes(charId)) return p;
    }
    return undefined;
  }

  addMember(partyId: number, charId: number): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p || p.members.length >= MAX_PARTY_MEMBERS || p.members.includes(charId)) return undefined;
    p.members.push(charId);
    return p;
  }

  /**
   * Remove a member. Returns `{ party, disbanded }`; `disbanded=true` means the
   * party dropped below 2 members and was deleted. Caller is responsible for
   * clearing `m_idParty` on remaining members + sending disband notices.
   */
  removeMember(partyId: number, charId: number): { party: Party | undefined; disbanded: boolean } {
    const p = this.parties.get(partyId);
    if (!p) return { party: undefined, disbanded: false };
    const idx = p.members.indexOf(charId);
    if (idx === -1) return { party: p, disbanded: false };
    p.members.splice(idx, 1);
    if (p.members.length < 2) {
      this.parties.delete(partyId);
      return { party: p, disbanded: true };
    }
    return { party: p, disbanded: false };
  }

  /** Swap `targetId` into slot 0 -- C++ `CParty::ChangeLeader`. */
  promoteLeader(partyId: number, targetId: number): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    const idx = p.members.indexOf(targetId);
    if (idx <= 0) return p;
    const tmp = p.members[0];
    p.members[0] = p.members[idx];
    p.members[idx] = tmp;
    return p;
  }

  /** List members (leader first). Returns empty for an unknown id. */
  members(partyId: number): number[] { return this.parties.get(partyId)?.members ?? []; }

  /** Advance the round-robin cursor + return the next looter charId (or undefined). */
  nextRoundRobin(partyId: number): number | undefined {
    const p = this.parties.get(partyId);
    if (!p || p.members.length === 0) return undefined;
    const id = p.members[p.roundRobinIdx % p.members.length];
    p.roundRobinIdx = (p.roundRobinIdx + 1) % p.members.length;
    return id;
  }

  /**
   * Disconnect hook -- clear pending invites referencing `charId` (as leader
   * or target) AND remove from any active party. Returns the affected party
   * (if any) so the service can re-broadcast roster / disband.
   */
  onDisconnect(charId: number): { party: Party | undefined; disbanded: boolean; wasLeader: boolean } {
    if (this.pending.has(charId)) this.removePending(charId);
    for (const [memberId, inv] of this.pending) {
      if (inv.leaderId === charId) { clearTimeout(inv.timer); this.pending.delete(memberId); }
    }
    const party = this.getByMember(charId);
    if (!party) return { party: undefined, disbanded: false, wasLeader: false };
    const wasLeader = party.members[0] === charId;
    const res = this.removeMember(party.id, charId);
    return { party: res.party, disbanded: res.disbanded, wasLeader };
  }
}
